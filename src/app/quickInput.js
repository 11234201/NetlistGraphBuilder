const INPUT_KINDS = new Set(["netlist", "aig", "level", "golden", "timing", "liberty"]);
const NETLIST_EXTENSIONS = new Set([".v", ".sv"]);
const TIMING_EXTENSIONS = new Set([".log", ".rpt", ".timing", ".sta"]);

const TIMING_DIRECTIVE_PATTERN = /^\s*@(?:module|stage|unit)\b/im;
const TIMING_HEADER_PATTERN =
  /^\s*(?:point|name|object|pin|path|node)(?:\s+|\s*,\s*)(?:at|arrival|rt|rat|required|slack|delay|incr|slew|trans|transition|edge|rf|pol|kind|type)\b/im;
const TIMING_ROW_PATTERN =
  /^\s*(?:\\\S+|"[^"]+"|[A-Za-z_$/][\w$.[\]/\\-]*)(?:\s+|\s*,\s*)(?:[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|-|NA|null)(?:\s+|\s*,\s*)(?:[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|-|NA|null)/im;

export function detectQuickInputKind(text, options = {}) {
  const preferredKind = options.preferredKind;
  if (INPUT_KINDS.has(preferredKind)) return preferredKind;

  const source = String(text || "").trim();
  const extension = getExtension(options.name);
  if (extension === ".lib") return "liberty";
  if (NETLIST_EXTENSIONS.has(extension)) return "netlist";
  if (extension === ".blif" || extension === ".dot") return "aig";
  if (extension === ".level") return "level";
  if (extension === ".csv" || extension === ".tsv") {
    // Batch classification asks first with just a filename. The header decides
    // between a Level table and the legacy Timing default for CSV/TSV.
    if (!source) throw new Error("Read the table header to identify this file");
    return hasLevelHeader(source) ? "level" : "timing";
  }
  if (TIMING_EXTENSIONS.has(extension)) return "timing";
  if (extension === ".json" || source.startsWith("{")) {
    return isTimingJsonSource(source) ? "timing" : "golden";
  }
  if (hasLibertyHeader(source)) return "liberty";
  const header = source.slice(skipCommentTrivia(source, 0));
  if (/^(?:strict\s+)?digraph\b/i.test(header) || /^\.model\b/.test(header)) return "aig";
  if (hasLevelHeader(source)) return "level";
  if (TIMING_DIRECTIVE_PATTERN.test(source)) return "timing";
  if (/(?:^|[\s;])module\s+(?:\\\S+|[A-Za-z_$][\w$]*)/im.test(source)) return "netlist";
  if (TIMING_HEADER_PATTERN.test(source)) return "timing";
  if (TIMING_ROW_PATTERN.test(source)) return "timing";
  throw new Error("input is not recognized as Verilog, AIG DOT/BLIF, Level, Liberty, Golden JSON, or timing text");
}

function hasLevelHeader(source) {
  const offset = skipCommentTrivia(source, 0);
  const end = source.indexOf("\n", offset);
  const header = source.slice(offset, end < 0 ? source.length : end);
  if (!/\b(?:at|rt|slack)_level\b/i.test(header)) return false;
  const columns = header.trim().toLowerCase()
    .split(/[\s,]+/).map(column => column.replace(/^"([^"]+)"$/, "$1"));
  return columns.includes("point") && columns.some(column => ["at_level", "rt_level", "slack_level"].includes(column));
}

function skipCommentTrivia(source, start, pending = {}) {
  let offset = start;
  while (offset < source.length) {
    if (pending.comment === "block") {
      const end = source.indexOf("*/", offset);
      if (end < 0) {
        pending.tail = source.endsWith("*") ? "*" : "";
        return source.length;
      }
      pending.comment = null;
      offset = end + 2;
    } else if (pending.comment === "line") {
      const end = source.indexOf("\n", offset);
      if (end < 0) return source.length;
      pending.comment = null;
      offset = end + 1;
    } else if (/\s/.test(source[offset])) offset++;
    else if (source.startsWith("/*", offset)) {
      pending.comment = "block";
      offset += 2;
    } else if (source.startsWith("//", offset) || source[offset] === "#") {
      pending.comment = "line";
      offset++;
    } else break;
  }
  return offset;
}

// Keep only the first significant text when a header follows long comments.
// Between slices, a trailing slash or star may belong to a comment delimiter.
export async function completeQuickInputHeader(file, sample, sampleBytes, signal) {
  const pending = {};
  let offset = sampleBytes;
  for (;;) {
    const first = skipCommentTrivia(sample, 0, pending);
    // Whitespace between two column names can itself cross a slice boundary.
    const header = sample.slice(first).replace(/[ \t]+/g, " ");
    if (offset >= file.size || header.length >= sampleBytes || !isIncompleteInputHeader(header)) return header;
    const end = Math.min(offset + sampleBytes, file.size);
    const next = await file.slice(offset, end).text();
    signal.throwIfAborted();
    sample = (header || pending.tail || "") + next;
    pending.tail = "";
    offset = end;
  }
}

// A BLIF name table or Level comment block may exceed the file sample.
// Recognize a directive or column heading split across the sample boundary.
export function isIncompleteInputHeader(sample) {
  const line = sample.slice(skipCommentTrivia(sample, 0));
  if (line === "/" || ".model".startsWith(line)) return true;
  if (line.includes("\n")) return false;
  const first = line.split(/[\s,]+/, 1)[0].replace(/^"|"$/g, "").toLowerCase();
  return ["point", "kind", "at", "rt", "slack", "at_level", "rt_level", "slack_level"].some(column => column.startsWith(first));
}

function hasLibertyHeader(source) {
  const start = skipCommentTrivia(source, 0);
  return source.startsWith("library", start) && source[skipCommentTrivia(source, start + 7)] === "(";
}

function isTimingJsonSource(source) {
  // A filename or a truncated prefix cannot distinguish Timing JSON from Golden.
  const value = JSON.parse(source);
  const isRecord = (item) => item !== null && typeof item === "object" && !Array.isArray(item);
  if (!isRecord(value) || value.kind === "netlist-layout-golden" || value.kind === "netlist-cell-config") return false;
  return ["points", "modules"].some((key) => Object.hasOwn(value, key) && isRecord(value[key]));
}

export function getQuickInputPriority(kind) {
  if (kind === "liberty") return -1;
  if (kind === "netlist" || kind === "aig") return 0;
  if (kind === "timing" || kind === "level") return 1;
  if (kind === "golden") return 2;
  return 3;
}

export function sortQuickInputBatch(entries, priority = getQuickInputPriority) {
  const mixedDesigns = entries.some(entry => entry.kind === "netlist") && entries.some(entry => entry.kind === "aig");
  return entries.sort((left, right) => {
    // Finish all netlist attachments while that workspace is active.
    if (mixedDesigns && left.kind !== right.kind) {
      if (left.kind === "aig") return 1;
      if (right.kind === "aig") return -1;
    }
    return priority(left.kind) - priority(right.kind);
  });
}

// Resolve pairs before any design is changed. One pair needs no naming
// convention. With multiple graphs, exact filename stems disambiguate pairs.
export function planAigLevelBatch(entries) {
  const levelForAig = new Map();
  const attachedLevels = new Set();
  const levels = entries.filter(entry => entry.kind === "level");
  if (!levels.length) return { levelForAig, attachedLevels };
  const graphs = entries.filter(entry => entry.kind === "aig");
  const reject = (level, message) => {
    throw Object.assign(new Error(message), {
      code: "AMBIGUOUS_LEVEL_TARGET", fileName: level.name, entryIndex: entries.indexOf(level)
    });
  };
  if (!graphs.length) {
    if (levels.length > 1 || entries.some(entry => entry.kind !== "level")) {
      reject(levels[0], "Choose one Level file for the active AIG, or include its AIG design in this batch.");
    }
    return { levelForAig, attachedLevels };
  }
  const stem = name => name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const byStem = new Map();
  for (const graph of graphs) {
    const key = stem(graph.name);
    byStem.set(key, byStem.has(key) ? null : graph);
  }
  const unmatched = [];
  for (const level of levels) {
    const graph = byStem.get(stem(level.name));
    if (!graph) { unmatched.push(level); continue; }
    if (levelForAig.has(graph)) reject(level, `Choose one Level file for ${graph.name}.`);
    levelForAig.set(graph, level);
    attachedLevels.add(level);
  }
  if (unmatched.length) {
    const available = graphs.filter(graph => !levelForAig.has(graph));
    if (unmatched.length !== 1 || available.length !== 1) {
      reject(unmatched[0], `Cannot pair ${unmatched[0].name}. Choose its AIG and Level file together, or use matching filenames.`);
    }
    levelForAig.set(available[0], unmatched[0]);
    attachedLevels.add(unmatched[0]);
  }
  return { levelForAig, attachedLevels };
}

function getExtension(name) {
  const match = String(name || "").toLowerCase().match(/(\.[^.\\/]+)$/);
  return match?.[1] || "";
}
