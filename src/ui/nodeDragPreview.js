export function createNodeDragPreview(mount, graph, nodeId, startPosition) {
  const nodeElement = findByDataset(mount, "[data-node-id]", "nodeId", nodeId);
  if (!nodeElement) return createEmptyPreview();

  const previousTransform = nodeElement.getAttribute?.("transform");
  const connectedEdgeIds = new Set((graph?.edges || [])
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .map((edge) => edge.id));
  const edgeElements = [...(mount.querySelectorAll?.("[data-edge-id]") || [])]
    .filter((element) => connectedEdgeIds.has(element.dataset?.edgeId));
  nodeElement.classList?.add("is-drag-preview-node");
  for (const element of edgeElements) element.classList?.add("is-drag-preview-edge");

  return {
    update(position) {
      const dx = finite(position?.x) - finite(startPosition?.x);
      const dy = finite(position?.y) - finite(startPosition?.y);
      nodeElement.setAttribute?.("transform", `translate(${round(dx)} ${round(dy)})`);
    },
    clear() {
      if (previousTransform === null || previousTransform === undefined) {
        nodeElement.removeAttribute?.("transform");
      } else {
        nodeElement.setAttribute?.("transform", previousTransform);
      }
      nodeElement.classList?.remove("is-drag-preview-node");
      for (const element of edgeElements) element.classList?.remove("is-drag-preview-edge");
    }
  };
}

function findByDataset(root, selector, property, value) {
  return [...(root?.querySelectorAll?.(selector) || [])]
    .find((element) => element.dataset?.[property] === value);
}

function createEmptyPreview() {
  return { update() {}, clear() {} };
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
