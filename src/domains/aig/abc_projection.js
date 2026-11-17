import { quoteDot } from "./dot_attributes.js";

// Free input ranks can greatly increase crossing-minimization work on deep
// reconvergent graphs. Bound that quality/cost tradeoff for this view alone.
export const AIG_ABC_GRAPHVIZ_POLICY = Object.freeze({ crossingMinimizationMultiplier: 0.25 });

// Inputs are ranked by their consumers so shallow output cones need not span
// every level. Both layouts share the same node metrics and visual notation.
export function projectAbcAigDot(model, limits, nodeDefaults) {
  const used = new Set(model.edges.flatMap((edge) => [edge.source, edge.target]));
  const nodes = model.nodes.filter((node) => node.kind !== "constant" || used.has(node.id)).sort(byId);
  const lines = ["digraph AIG {",
    `graph [rankdir=BT, splines=true, nodesep=0.35, ranksep=0.65, pad=0.2, bgcolor="transparent", nslimit=${limits.networkSimplexIterationsPerNode}, nslimit1=${limits.rankIterationsPerNode}, mclimit=${AIG_ABC_GRAPHVIZ_POLICY.crossingMinimizationMultiplier}];`,
    nodeDefaults, 'edge [arrowsize=0.65];'];
  for (const node of nodes) {
    const shape = { pi: "triangle", po: "invtriangle", and: "ellipse", constant: "box" }[node.kind];
    lines.push(`${quoteDot(node.id)} [id=${quoteDot(node.id)}, label=${quoteDot(node.label)}, shape=${shape}];`);
  }
  const outputs = nodes.filter((node) => node.kind === "po").map((node) => quoteDot(node.id));
  if (outputs.length) lines.push(`{ rank=max; ${outputs.join("; ")}; }`);
  for (const edge of [...model.edges].sort(byId)) lines.push(`${quoteDot(edge.source)} -> ${quoteDot(edge.target)} [id=${quoteDot(edge.id)}, style=${edge.inverted ? "dashed" : "solid"}];`);
  lines.push("}");
  return lines.join("\n");
}

function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
