import { normalizeStructurePolicy } from "../../analysis/structure_policy.js";
import { readReconvergenceDetail } from "../../analysis/reconvergence.js";
import { serializeWorkerError } from "../../foundation/worker_error.js";
import { createNetlistStructureIndex, analyzeNetlistReconvergence } from "./reconvergence_analysis.js";

let index;
globalThis.onmessage = ({ data }) => {
  try {
    if (data.type === "initialize") { index = createNetlistStructureIndex(data.model); return; }
    if (!index) throw new Error("Analysis worker has no source model");
    const policy = normalizeStructurePolicy(data.policy);
    const result = data.type === "detail" ? readReconvergenceDetail(index, data.result, policy)
      : analyzeNetlistReconvergence(index, policy);
    globalThis.postMessage({ id: data.id, result });
  } catch (error) {
    globalThis.postMessage({ id: data.id, error: serializeWorkerError(error) });
  }
};
