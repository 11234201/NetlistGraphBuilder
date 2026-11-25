const highlightClasses = ["is-selected", "is-compare-counterpart", "is-compare-match", "is-compare-unmatched"];

// Export the committed scene at full detail. Only transient highlight classes
// come from the visible side, so pan, zoom and live gesture styles stay local.
export function withSchematicExportHighlights(scene, mount) {
  const nodes = new Map();
  const nets = new Map();
  const selector = highlightClasses.map(name => "." + name).join(",");
  for (const item of mount.querySelectorAll(selector)) {
    const classes = highlightClasses.filter(name => item.classList.contains(name)).join(" ");
    if (item.dataset.nodeId !== undefined) nodes.set(item.dataset.nodeId, classes);
    if (item.dataset.net !== undefined) nets.set(item.dataset.net, classes);
  }
  function decorate(primitives, index, attribute) {
    return primitives.map(primitive => {
      const attributes = primitive.attributes;
      const classes = index.get(attributes?.[attribute]);
      if (!classes) return primitive;
      return { ...primitive, attributes: { ...attributes, class: attributes.class + " " + classes } };
    });
  }
  if (!nodes.size && !nets.size) return scene;
  return { ...scene,
    readNodes: (start, end) => decorate(scene.readNodes(start, end), nodes, "data-node-id"),
    readEdges: (start, end) => decorate(scene.readEdges(start, end), nets, "data-net")
  };
}
