import { projectAbcAigDot } from "./abc_projection.js";
import { normalizeAigViewStyle } from "./aig_presentation.js";
import { quoteDot as quote } from "./dot_attributes.js";

export const AIG_DISPLAY_VERSION = 8;
export const AIG_FONT = "Arial";
// Graphviz otherwise permits INT_MAX network-simplex iterations. These named
// quality/cost limits supplement the Worker's hard timeout; they do not change
// the AIG's depth ranks, spline routing or crossing-minimization policy.
export const AIG_GRAPHVIZ_POLICY = Object.freeze({ networkSimplexIterationsPerNode: 2, rankIterationsPerNode: 2 });

// Normalization numbers nodes and input slots in their canonical declaration order.
const idOrder = new Intl.Collator("en", { numeric: true });
const byCanonicalId = (a, b) => idOrder.compare(a.id, b.id);

// Only generated, quoted attributes reach Graphviz. Source DOT attributes never
// cross this boundary (including URLs, images, HTML labels and scripts).
export function projectAigDot(model, presentation = {}) {
  const nodeDefaults = `node [fontname=${quote(AIG_FONT)}, fontsize=12, margin="0.12,0.07"];`;
  if (normalizeAigViewStyle(presentation?.viewStyle) === "abc") return projectAbcAigDot(model, AIG_GRAPHVIZ_POLICY, nodeDefaults);
  const used = new Set(model.edges.flatMap((edge) => [edge.source, edge.target]));
  const nodes = model.nodes.filter((node) => node.kind !== "constant" || model.focused || used.has(node.id)).sort(byCanonicalId);
  const lines = ["digraph AIG {", `graph [rankdir=BT, splines=true, nodesep=0.35, ranksep=0.65, pad=0.2, bgcolor="transparent", nslimit=${AIG_GRAPHVIZ_POLICY.networkSimplexIterationsPerNode}, nslimit1=${AIG_GRAPHVIZ_POLICY.rankIterationsPerNode}];`,
    nodeDefaults, 'edge [arrowsize=0.65];'];
  const ranks = new Map();
  for (const node of nodes) {
    const shape = { pi: "triangle", po: "invtriangle", and: "ellipse", constant: "box", boundary: "box" }[node.kind];
    lines.push(`${quote(node.id)} [id=${quote(node.id)}, label=${quote(node.label)}, shape=${shape}];`);
    // A cut marks the driver's signal. Put a fanout marker one display row
    // above its driver without adding a logic level to that signal.
    const rank = node.kind === "po" ? "output" : String((node.level || 0) + Number(node.boundaryDirection === "out"));
    if (!ranks.has(rank)) ranks.set(rank, []);
    ranks.get(rank).push(quote(node.id));
  }
  for (const [rank, ids] of ranks) lines.push(`{ rank=${rank === "output" ? "max" : rank === "0" ? "min" : "same"}; ${ids.join("; ")}; }`);
  if (model.hasInputLevelOffsets) {
    // rank=same groups only constrain peers. Connect one representative of
    // each occupied level so independent branches respect their PI offsets.
    const occupied = [...ranks.keys()].filter(rank => rank !== "output").sort((a, b) => Number(a) - Number(b));
    for (let i = 1; i < occupied.length; i++) {
      lines.push(`${ranks.get(occupied[i - 1])[0]} -> ${ranks.get(occupied[i])[0]} [style=invis];`);
    }
  }
  for (const edge of [...model.edges].sort(byCanonicalId)) lines.push(`${quote(edge.source)} -> ${quote(edge.target)} [id=${quote(edge.id)}, style=${edge.inverted ? "dashed" : "solid"}];`);
  lines.push("}");
  return lines.join("\n");
}
