import { createStructureIndex } from "./structure_index.js";
import { analyzeStructureIndex } from "./structure_analysis.js";
import { readReconvergenceDetail } from "./structure_reconvergence.js";
import { normalizeStructurePolicy } from "./structure_policy.js";

let index = null;
globalThis.onmessage = ({ data }) => {
  try {
    if (data.type === "initialize") { index = createStructureIndex(data.model); return; }
    if (!index) throw new Error("Analysis worker has no source model");
    const policy = normalizeStructurePolicy(data.policy);
    const result = data.type === "detail" ? readReconvergenceDetail(index, data.result, policy)
      : analyzeStructureIndex(index, policy, (progress) => globalThis.postMessage({ id: data.id, progress }));
    globalThis.postMessage({ id: data.id, result });
  } catch (error) {
    globalThis.postMessage({ id: data.id, error: { name: error.name, message: error.message } });
  }
};
