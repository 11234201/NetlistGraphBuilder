import { findCompareNode } from "../domains/netlist/compare_objects.js";

// A counterpart highlight is a visual match. Only the explicitly selected
// object belongs to that side's ViewSession.
export function renderCompareSelectionHighlights({ compare, elements, readSelection, escape }) {
  const active = compare.selectedSide ? readSelection(compare.selectedSide) : null;
  for (const side of ["left", "right"]) {
    const mount = side === "left" ? elements.leftMount : elements.rightMount;
    for (const old of mount.querySelectorAll(".is-selected,.is-compare-counterpart")) {
      old.classList.remove("is-selected", "is-compare-counterpart");
    }
    const graph = compare.graphs[side];
    function highlight(ref, className) {
      if (!ref) return;
      if (ref.kind === "net") {
        for (const edge of mount.querySelectorAll(".edge")) {
          if (edge.dataset.net === ref.localId) edge.classList.add(className);
        }
      } else {
        const node = findCompareNode(graph, ref.kind, ref.localId);
        if (node) mount.querySelector(`[data-node-id="${escape(node.id)}"]`)?.classList.add(className);
      }
    }
    highlight(readSelection(side), "is-selected");
    if (side !== compare.selectedSide) highlight(active, "is-compare-counterpart");
  }
}
