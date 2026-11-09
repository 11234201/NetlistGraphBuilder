const INPUT_KINDS = new Set(["netlist", "golden", "timing"]);
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
  if (NETLIST_EXTENSIONS.has(extension)) return "netlist";
  if (TIMING_EXTENSIONS.has(extension)) return "timing";
  if (extension === ".json") {
    if (source && isTimingJsonSource(source)) return "timing";
    return "golden";
  }

  if (source.startsWith("{")) {
    return isTimingJsonSource(source) ? "timing" : "golden";
  }
  if (TIMING_DIRECTIVE_PATTERN.test(source)) return "timing";
  if (/(?:^|[\s;])module\s+(?:\\\S+|[A-Za-z_$][\w$]*)/im.test(source)) return "netlist";
  if (TIMING_HEADER_PATTERN.test(source)) return "timing";
  if (TIMING_ROW_PATTERN.test(source)) return "timing";
  throw new Error("input is not recognized as Verilog, Golden JSON, or timing text");
}

function isTimingJsonSource(source) {
  if (/"netlist-layout-golden"|"netlist-cell-config"/.test(source)) return false;
  return /"(?:points|modules)"\s*:\s*\{/.test(source);
}

export function getQuickInputPriority(kind) {
  if (kind === "netlist") return 0;
  if (kind === "timing") return 1;
  if (kind === "golden") return 2;
  return 3;
}

function getExtension(name) {
  const match = String(name || "").toLowerCase().match(/(\.[^.\\/]+)$/);
  return match?.[1] || "";
}
