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
    if (nodeId) {
      container.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`)?.classList.add("is-selected");
    }
    onNodeSelection(nodeId || null);
  }

  function selectNet(netName) {
    clearDomSelection();
    for (const edgeElement of container.querySelectorAll(".edge")) {
      if (edgeElement.dataset.net === netName) edgeElement.classList.add("is-selected");
    }
    onNetSelection(netName || null);
  }

  return Object.freeze({ selectNode, selectNet, clearDomSelection });
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}
