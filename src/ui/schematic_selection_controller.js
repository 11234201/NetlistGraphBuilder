export function createSchematicSelectionController({ container, onNodeSelection, onNetSelection }) {
  if (!container || typeof onNodeSelection !== "function" || typeof onNetSelection !== "function") {
    throw new Error("Schematic selection controller requires a container and selection ports");
  }

  function clearDomSelection() {
    for (const element of container.querySelectorAll(".node.is-selected, .edge.is-selected")) {
      element.classList.remove("is-selected");
    }
  }

  function selectNode(nodeId) {
    clearDomSelection();
    paintSchematicSelection(container, nodeId, null);
    onNodeSelection(nodeId || null);
  }

  function selectNet(netName) {
    clearDomSelection();
    paintSchematicSelection(container, null, netName);
    onNetSelection(netName || null);
  }

  return Object.freeze({ selectNode, selectNet, clearDomSelection });
}

// A committed re-render replaces the SVG subtree. Reapply the visual state
// without dispatching another selection command or recording history.
export function paintSchematicSelection(container, nodeId, netName) {
  if (nodeId) container.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`)?.classList.add("is-selected");
  if (netName) {
    for (const edge of container.querySelectorAll(".edge")) {
      if (edge.dataset.net === netName) edge.classList.add("is-selected");
    }
  }
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}
