import { AIG_IMPORT_LIMITS, aigError } from "../domains/aig/aig_diagnostics.js";

export async function readAigLevelFile(file, signal) {
  const limit = AIG_IMPORT_LIMITS.sourceCharacters;
  const tooLarge = () => aigError("Level input exceeds the AIG source size limit", file, {}, "aig.level-limit");
  // UTF-8 needs at most three bytes per UTF-16 code unit, plus a possible BOM.
  if (file.size > 3 * limit + 3) throw tooLarge();
  if (!(file.size > limit) || !file.slice) return file.text();
  const decoder = new TextDecoder();
  const chunkBytes = 1024 * 1024;
  let text = "";
  for (let start = 0; start < file.size; start += chunkBytes) {
    signal?.throwIfAborted();
    const end = Math.min(start + chunkBytes, file.size);
    const bytes = await file.slice(start, end).arrayBuffer();
    text += decoder.decode(bytes, {stream:end < file.size});
    if (text.length > limit) throw tooLarge();
  }
  return text;
}

// A draft belongs to the graph on which the editor was opened. A file import
// without an editor uses the active graph of its cancellable input request.
export function requireAigLevelTarget(graphId, expectedId) {
  if (!graphId) throw Object.assign(new Error("Open an AIG before loading a Level file"), { code: "aig.level.no-graph" });
  if (expectedId !== undefined && graphId !== expectedId)
    throw Object.assign(new Error("The target AIG changed. Reopen the Level input for the intended graph."), { code: "aig.level.graph-changed" });
}

export function aigLevelFailureDetails(input, error, candidate = {}) {
  const diagnostic = error?.diagnostic;
  const levelFailed = String(error?.code || "").startsWith("aig.level");
  const operation = levelFailed ? "aig.level.import" : candidate.jobId ? "aig.workspace.prepare" : "aig.import";
  return { domainId: "aig", operation, designFileName: input.name, levelFileName: input.levelFile.name,
    fileName: diagnostic?.file || (levelFailed ? input.levelFile.name : input.name),
    line: diagnostic?.line, column: diagnostic?.column, objectId: diagnostic?.objectId };
}
