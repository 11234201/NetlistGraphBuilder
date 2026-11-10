const INPUT_KINDS = new Set(["netlist", "golden", "timing", "liberty"]);
const NETLIST_EXTENSIONS = new Set([".v", ".sv"]);
const TIMING_EXTENSIONS = new Set([".log", ".rpt", ".timing", ".sta", ".csv", ".tsv"]);

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
  if (TIMING_EXTENSIONS.has(extension)) return "timing";
  if (extension === ".json" || source.startsWith("{")) {
    return isTimingJsonSource(source) ? "timing" : "golden";
  }
  if (hasLibertyHeader(source)) return "liberty";
  if (TIMING_DIRECTIVE_PATTERN.test(source)) return "timing";
  if (/(?:^|[\s;])module\s+(?:\\\S+|[A-Za-z_$][\w$]*)/im.test(source)) return "netlist";
  if (TIMING_HEADER_PATTERN.test(source)) return "timing";
  if (TIMING_ROW_PATTERN.test(source)) return "timing";
  throw new Error("input is not recognized as Verilog, Liberty, Golden JSON, or timing text");
}

function skipCommentTrivia(source, start) {
  let offset = start;
  while (offset < source.length) {
    if (/\s/.test(source[offset])) { offset += 1; continue; }
    if (source.startsWith("/*", offset)) {
      const end = source.indexOf("*/", offset + 2);
      if (end < 0) return source.length;
      offset = end + 2;
    } else if (source.startsWith("//", offset)) {
      const end = source.indexOf("\n", offset + 2);
      if (end < 0) return source.length;
      offset = end + 1;
    } else break;
  }
  return offset;
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
  if (kind === "netlist") return 0;
  if (kind === "timing") return 1;
  if (kind === "golden") return 2;
  return 3;
}

function getExtension(name) {
  const match = String(name || "").toLowerCase().match(/(\.[^.\\/]+)$/);
  return match?.[1] || "";
}
