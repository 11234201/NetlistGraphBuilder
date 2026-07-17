const INPUT_KINDS = new Set(["netlist", "golden", "timing"]);
const NETLIST_EXTENSIONS = new Set([".v", ".sv"]);

export function detectQuickInputKind(text, options = {}) {
  const preferredKind = options.preferredKind;
  if (INPUT_KINDS.has(preferredKind)) return preferredKind;

  const extension = getExtension(options.name);
  if (NETLIST_EXTENSIONS.has(extension)) return "netlist";
  if (extension === ".json") return "golden";
  if (extension === ".log") return "timing";

  const source = String(text || "").trim();
  if (source.startsWith("{")) return "golden";
  if (/\bmodule\s+(?:\\\S+|[A-Za-z_$][\w$]*)/i.test(source)) return "netlist";
  if (/\binst\s*<[^>]+>/i.test(source)) return "timing";
  throw new Error("input is not recognized as Verilog, Golden JSON, or timing text");
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
