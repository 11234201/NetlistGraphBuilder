import { findReconvergence as analyze } from "../../analysis/reconvergence.js";
export { readReconvergenceDetail } from "../../analysis/reconvergence.js";

const aigRules = {
  canBranch: (node) => node.kind === "and" || node.kind === "pi",
  canVisit: (node) => node.kind === "and",
  canMerge: (node) => node.kind === "and",
  stepCost: (node) => Number(node.kind === "and")
};

export function findReconvergence(index, policy) {
  const analysis = analyze(index, policy, aigRules);
  for (const result of analysis.results) {
    result.paths = result.paths.map(({ depth, ...path }) => ({ ...path, andDepth: depth }));
  }
  return analysis;
}
