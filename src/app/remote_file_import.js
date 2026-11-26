import { detectQuickInputKind, planAigLevelBatch, sortQuickInputBatch } from "./quickInput.js";

export function commandFailure(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

const fixedKinds = new Map([
  ["aig open", "aig"], ["level open", "level"], ["timing open", "timing"], ["timing add", "timing"],
  ["golden load", "golden"], ["liberty load", "liberty"], ["cell-config import", "cell-config"]
]);

export function compareSideFor(mode, side, allowed) {
  if (!side) return null;
  if (mode !== "Compare" || !allowed || !["A", "B"].includes(side)) {
    throw commandFailure("INVALID_SIDE", "A Compare side is unavailable for this action");
  }
  return side === "A" ? "left" : "right";
}

function errorRecord(error) {
  return { code: error.code || "IMPORT_FAILED", message: error.message };
}

export function createRemoteFileImport({ context, graphs, importRequests, loadText, loadCellConfig, priority, logFile }) {
  return async function importFiles({ id, name, files, opts, continuation }) {
    if (continuation && (continuation.name !== name || continuation.side !== (opts.side || "") ||
        continuation.documentVersion !== context().documentVersion)) {
      throw commandFailure("STALE_DOCUMENT", "The previous import no longer belongs to this target");
    }
    const seen = new Set(continuation?.seenKinds || []);
    function syncRetainedKinds() {
      // Leaving AIG clears its collection; a later AIG must open before it can append.
      if (context().mode !== "AIG") seen.delete("aig");
    }
    function recovery() {
      syncRetainedKinds();
      const targetContext = context();
      return {targetContext, continuation:{name, side:opts.side || "", documentVersion:targetContext.documentVersion,
        seenKinds:["netlist", "aig", "timing"].filter(kind => seen.has(kind))}};
    }
    const mixed = name === "files import";
    const adding = name.endsWith(" add");
    const explicitAig = name === "aig add" || (name === "design add" && context().mode === "AIG");
    const compareSide = compareSideFor(context().mode, opts.side, mixed || name.startsWith("design ") || name.startsWith("timing "));
    if (explicitAig) return graphs.add(files);
    if (!files.length) throw commandFailure("INVALID_ARGUMENT", "Choose at least one input file");
    const results = new Array(files.length);
    const entries = [];
    let firstFileError;
    const receipt = () => files.map((file, index) => results[index] || { name:file.name, status:"uncommitted" });
    function failed(file, index, error, kind, details = {}) {
      const item = { name: file.name, kind, status: "failed", error: errorRecord(error) };
      results[index] = item;
      if (!file.error && (mixed || details.operation)) {
        firstFileError ??= error;
        const {graphId,documentId,documentVersion} = context();
        logFile(error, name, id, {fileName:file.name, kind, side:opts.side, graphId, documentId, documentVersion, ...details});
      }
      if (!mixed) {
        error.files = receipt();
        if (seen.size || continuation) Object.assign(error, recovery());
        throw error;
      }
    }
    // Preserve caller order in the receipt. The workspace import order follows
    // the same library/design/attachment policy as local multi-file drops.
    for (const [index, file] of files.entries()) {
      try {
        if (file.error) {
          // Preserve identifiable failed pair members for the binding step.
          if (mixed && /\.(v|sv|dot|blif|level)$/i.test(file.name))
            entries.push({ index, file, name:file.name, kind:detectQuickInputKind("", { name:file.name }) });
          throw commandFailure(file.error.code, file.error.message);
        }
        const kind = fixedKinds.get(name) || detectQuickInputKind(file.text, { name: file.name });
        if (!mixed && name.startsWith("design ") && !["netlist", "aig"].includes(kind)) {
          throw commandFailure("WRONG_INPUT_KIND", "Expected a Verilog, DOT or BLIF design");
        }
        if (compareSide && !["netlist", "timing"].includes(kind)) {
          throw commandFailure("INVALID_SIDE", "Compare file inputs accept netlists and timing reports");
        }
        entries.push({ index, file, name:file.name, kind });
      } catch (error) { failed(file, index, error); }
    }
    const pureAig = entries.length > 0 && entries.every(e => e.kind === "aig");
    if (name === "design add" && pureAig) return graphs.add(files);
    if (name === "design add" && entries.some(e => e.kind === "aig")) {
      throw commandFailure("DOMAIN_MISMATCH", "Choose either netlists or AIGs for a design add", {
        files: files.map(file => ({name:file.name, status:"uncommitted"}))
      });
    }
    if (mixed && entries.filter(e => e.kind === "liberty").length > 1) {
      throw commandFailure("MULTIPLE_LIBRARIES", "Choose one Liberty file per batch");
    }
    if (entries.some(entry => entry.kind === "level") && entries.length !== files.length) {
      throw commandFailure("AMBIGUOUS_LEVEL_TARGET", "A file could not be identified. Select its AIG and Level file together.", {
        files: receipt()
      });
    }
    let pairs;
    try { pairs = planAigLevelBatch(entries); }
    catch (error) {
      const entry = entries[error.entryIndex];
      if (!entry) throw error;
      failed(entry.file, entry.index, error, entry.kind, {operation:"pair-aig-level"});
      error.files = receipt();
      throw error;
    }
    const {levelForAig, attachedLevels} = pairs;
    sortQuickInputBatch(entries, priority);
    const hasNetlist = entries.some(e => e.kind === "netlist");
    const unidentifiedInput = entries.length !== files.length;
    let designReady = adding || seen.has("netlist");
    const request = entries.length ? importRequests.begin() : null;
    for (const entry of entries) {
      syncRetainedKinds();
      const {index, file, kind} = entry;
      if (attachedLevels.has(entry)) continue;
      const level = levelForAig.get(entry);
      if (level && (results[index] || results[level.index])) {
        const other = results[index] ? level : entry;
        results[other.index] ??= {name:other.name, kind:other.kind, status:"skipped", reason:"Could not read paired file"};
        continue;
      }
      if (results[index]) continue;
      request.signal.throwIfAborted();
      const requiresDesign = hasNetlist || (unidentifiedInput && kind === "timing");
      if (mixed && requiresDesign && !designReady && !["aig", "netlist", "liberty"].includes(kind)) {
        results[index] = { name: file.name, kind, status: "skipped", reason: "No netlist in this batch loaded successfully" };
        continue;
      }
      const details = {};
      try {
        if (kind === "level" && context().mode !== "AIG") {
          throw commandFailure("DOMAIN_MISMATCH", "Open an AIG before loading its Level file");
        }
        if (context().mode === "AIG" && !["netlist", "aig", "level"].includes(kind)) {
          throw commandFailure("DOMAIN_MISMATCH", "Open a netlist before loading this input");
        }
        if (kind === "cell-config") {
          await loadCellConfig(file, opts);
        } else {
          const appendable = kind === "netlist" || kind === "timing" || kind === "aig";
          const append = appendable && (adding || seen.has(kind));
          const view = opts.view;
          const options = { kind, label:file.name, request, append, compareSide };
          if (level) options.levelFile = level.file;
          if (level || kind === "level") options.onFailureContext = context => Object.assign(details, context);
          if (kind === "liberty") options.signal = request.signal;
          if (view) {
            options.deferLayout = view === "search-first";
            options.presentationPolicy = { viewStyle:view === "standard" ? "standard" : "abc" };
          }
          const result = await loadText(file.text, options);
          if (!result) throw commandFailure("CANCELLED", "Import cancelled or superseded");
        }
        request.signal.throwIfAborted();
        seen.add(kind);
        if (kind === "netlist") designReady = true;
        results[index] = { name:file.name, kind, status:"committed" };
        if (level) results[level.index] = {name:level.name, kind:"level", status:"committed"};
      } catch (error) {
        request.signal.throwIfAborted();
        if (error.name === "AbortError" || error.code === "CANCELLED") throw error;
        const target = level && (details.operation === "aig.level.import" || String(error.code || "").startsWith("aig.level")) ? level : entry;
        if (level) {
          const other = target === level ? entry : level;
          results[other.index] = {name:other.name, kind:other.kind, status:"uncommitted"};
        }
        failed(target.file, target.index, error, target.kind, details);
      }
    }
    const partial = results.some(item => item.status !== "committed");
    if (partial && !results.some(item => item.status === "committed")) {
      throw commandFailure("IMPORT_FAILED", "No files were imported", {
        files:results, cause:firstFileError, ...(continuation ? recovery() : {})
      });
    }
    return { ...context(), files:results, partial, ...(partial ? recovery() : {}) };
  };
}
