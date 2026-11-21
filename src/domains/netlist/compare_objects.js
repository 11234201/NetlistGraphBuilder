export function findCompareNode(graph, kind, name, portKind = null) {
  return graph?.nodes.find((node) => {
    if (kind === "cell") {
      return node.kind === "cell" && getCompareNodeName(node) === name;
    }
    if (kind === "port") {
      return (node.kind === "input" || node.kind === "output")
        && (!portKind || node.kind === portKind)
        && getCompareNodeName(node) === name;
    }
    return false;
  }) || null;
}

export function getCompareNodeName(node) {
  if (!node) {
    return null;
  }
  return node.kind === "cell"
    ? node.ref?.instance || node.label
    : node.ref?.name || node.label;
}
