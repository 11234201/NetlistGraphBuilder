import { parseDotSource } from "./dot_parser.js";
import { parseBlifSource } from "./blif_parser.js";
import { adaptAbcDot, adaptAndNotBlif } from "./aig_semantics.js";
import { normalizeAig } from "./aig_normalize.js";
import { bindBlifNames } from "./blif_names.js";
import { analyzeAig } from "./aig_analysis.js";
import { applyAigLevelFile } from "./aig_level.js";
import { freezeAig, requireAig } from "./aig_diagnostics.js";

export function importAigSource(text, options = {}) {
  const format = options.format === "dot" ? "abc-dot" : options.format || (/\.blif$/i.test(options.name || "") || /^\s*(?:#[^\n]*\n\s*)*\.model\b/.test(text) ? "blif" : "abc-dot");
  requireAig(["abc-dot", "blif"].includes(format), "Supported formats are ABC AIG DOT and flat two-input BLIF", options);
  const source = format === "abc-dot" ? parseDotSource(text, options) : parseBlifSource(text, options);
  const raw = format === "abc-dot" ? adaptAbcDot(source, options) : adaptAndNotBlif(source, options);
  const model = bindBlifNames(normalizeAig(raw, options), source.mappingCandidates);
  const imported = { format, name: options.name || raw.name || "AIG", source, model };
  if (options.levelFile) return applyAigLevelFile(imported, options.levelFile);
  return freezeAig({ ...imported, analysis: analyzeAig(model) });
}
