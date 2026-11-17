import { createStructureIndex } from "./structure_index.js";
import { AIG_STRUCTURE_VERSION, normalizeStructurePolicy } from "./structure_policy.js";
import { findStructureBlocks } from "./structure_blocks.js";
import { findReconvergence, readReconvergenceDetail } from "./structure_reconvergence.js";

export function analyzeAigStructure(model, options = {}, onProgress = () => {}) {
  return analyzeStructureIndex(createStructureIndex(model), options, onProgress);
}

export function analyzeStructureIndex(index, options = {}, onProgress = () => {}) {
  const policy = normalizeStructurePolicy(options);
  onProgress({ stage: "blocks" });
  const blocks = findStructureBlocks(index, policy);
  onProgress({ stage: "reconvergence", blockCount: blocks.results.length });
  const reconvergence = findReconvergence(index, policy);
  return { version: AIG_STRUCTURE_VERSION, policy, policyFingerprint: JSON.stringify(policy),
    status: blocks.status === "complete" && reconvergence.status === "complete" ? "complete" : "partial", blocks, reconvergence };
}

export function getAigStructureDetail(model, result, policy) {
  return readReconvergenceDetail(createStructureIndex(model), result, normalizeStructurePolicy(policy));
}
