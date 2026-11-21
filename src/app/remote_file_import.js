import { detectQuickInputKind } from "./quickInput.js";

export function commandFailure(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

const fixedKinds = new Map([
  ["aig open", "aig"], ["timing open", "timing"], ["timing add", "timing"],
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
  return async function importFiles({ id, name, files, opts }) {
    const mixed = name === "files import";
    const adding = name.endsWith(" add");
    const explicitAig = name === "aig add" || (name === "design add" && context().mode === "AIG");
    const compareSide = compareSideFor(context().mode, opts.side, mixed || name.startsWith("design ") || name.startsWith("timing "));
    if (explicitAig) return graphs.add(files);
    if (!files.length) throw commandFailure("INVALID_ARGUMENT", "Choose at least one input file");
    const results = new Array(files.length);
    const entries = [];
    function failed(file, index, error, kind) {
      const item = { name: file.name, kind, status: "failed", error: errorRecord(error) };
      results[index] = item;
      if (!mixed) {
        error.files = files.map((file, i) => results[i] || { name: file.name, status: "uncommitted" });
        throw error;
      }
      if (!file.error) {
        const {graphId,documentId,documentVersion} = context();
        logFile(error, name, id, {fileName:file.name, kind, side:opts.side, graphId, documentId, documentVersion});
      }
    }
    // Preserve caller order in the receipt. The workspace import order follows
    // the same library/design/attachment policy as local multi-file drops.
    for (const [index, file] of files.entries()) {
      try {
        if (file.error) throw commandFailure(file.error.code, file.error.message);
        const kind = fixedKinds.get(name) || detectQuickInputKind(file.text, { name: file.name });
        if (!mixed && name.startsWith("design ") && !["netlist", "aig"].includes(kind)) {
          throw commandFailure("WRONG_INPUT_KIND", "Expected a Verilog, DOT or BLIF design");
        }
        if (compareSide && !["netlist", "timing"].includes(kind)) {
          throw commandFailure("INVALID_SIDE", "Compare file inputs accept netlists and timing reports");
        }
        entries.push({ index, file, kind });
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
    entries.sort((left, right) => priority(left.kind) - priority(right.kind) || left.index - right.index);
    let designReady = adding || !entries.some(e => e.kind === "netlist");
    const seen = new Set();
    const request = entries.length ? importRequests.begin() : null;
    for (const {index, file, kind} of entries) {
      request.signal.throwIfAborted();
      if (mixed && !designReady && !["aig", "netlist", "liberty"].includes(kind)) {
        results[index] = { name: file.name, kind, status: "skipped", reason: "No netlist in this batch loaded successfully" };
        continue;
      }
      try {
        if (context().mode === "AIG" && !["netlist", "aig"].includes(kind)) {
          throw commandFailure("DOMAIN_MISMATCH", "Open a netlist before loading this input");
        }
        if (kind === "cell-config") {
          await loadCellConfig(file, opts);
        } else {
          const appendable = kind === "netlist" || kind === "timing" || pureAig;
          const append = appendable && (adding || seen.has(kind));
          const view = opts.view;
          const options = { kind, label:file.name, request, append, compareSide };
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
      } catch (error) {
        request.signal.throwIfAborted();
        if (error.name === "AbortError" || error.code === "CANCELLED") throw error;
        failed(file, index, error, kind);
      }
    }
    const partial = results.some(item => item.status !== "committed");
    if (partial && !results.some(item => item.status === "committed")) {
      throw commandFailure("IMPORT_FAILED", "No files were imported", { files: results });
    }
    return { ...context(), files:results, partial };
  };
}
