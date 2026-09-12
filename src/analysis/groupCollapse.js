export function collapseLargeGraph(graph, options = {}) {
  const threshold = options.threshold || 300;
  const groupSize = options.groupSize || 50;
  const expandedGroupIds = options.expandedGroupIds || new Set();
  const cells = graph.nodes.filter((node) => node.kind === "cell");
  if (cells.length < threshold) return graph;

  const groupByNodeId = new Map();
  const groups = [];
  for (let start = 0; start < cells.length; start += groupSize) {
    const members = cells.slice(start, start + groupSize);
    const id = `group:cells-${start}-${start + members.length - 1}`;
    const group = { id, members, expanded: expandedGroupIds.has(id) };
    groups.push(group);
    if (!group.expanded) for (const node of members) groupByNodeId.set(node.id, group);
  }
  const collapsedGroups = groups.filter((group) => !group.expanded);
  const hidden = new Set(collapsedGroups.flatMap((group) => group.members.map((node) => node.id)));
  const nodes = graph.nodes.filter((node) => !hidden.has(node.id));
  nodes.push(...collapsedGroups.map((group) => ({
    id: group.id,
    kind: "group",
    label: `${group.members.length} cells`,
    title: "COLLAPSED",
    subtitle: `${group.members[0].label} … ${group.members.at(-1).label}`,
    ref: { groupId: group.id, memberCount: group.members.length }
  })));
  const edgeKeys = new Set();
  const edges = [];
  for (const edge of graph.edges) {
    const source = groupByNodeId.get(edge.source)?.id || edge.source;
    const target = groupByNodeId.get(edge.target)?.id || edge.target;
    if (source === target) continue;
    const key = `${source}\u0000${target}\u0000${edge.net}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ ...edge, id: `collapsed:${edges.length}`, source, target });
  }
  const groupNodes = new Map(nodes
    .filter((node) => node.kind === "group")
    .map((node) => [node.id, node]));
  const descriptorsByGroup = new Map();
  const collapsedEdges = edges.map((edge) => {
    const next = { ...edge };
    if (groupNodes.has(edge.source)) {
      next.originalSourcePin = edge.sourcePin;
      next.sourcePin = addGroupPort(
        groupNodes.get(edge.source), descriptorsByGroup, "output", edge
      );
    }
    if (groupNodes.has(edge.target)) {
      next.originalTargetPin = edge.targetPin;
      next.targetPin = addGroupPort(
        groupNodes.get(edge.target), descriptorsByGroup, "input", edge
      );
    }
    return next;
  });
  const positionedNodes = nodes.map((node) => {
    const descriptors = descriptorsByGroup.get(node.id);
    return descriptors ? {
      ...node,
      portDescriptors: descriptors.toSorted((left, right) =>
        left.pin.localeCompare(right.pin))
    } : node;
  });
  return {
    ...graph,
    nodes: positionedNodes,
    edges: collapsedEdges,
    groups,
    collapsedGroupCount: collapsedGroups.length
  };
}

function addGroupPort(group, descriptorsByGroup, direction, edge) {
  const side = direction === "output" ? "right" : "left";
  const signature = [
    direction,
    edge.source,
    edge.target,
    edge.net,
    edge.sourcePin,
    edge.targetPin
  ].map((value) => String(value ?? "")).join("\u0001");
  const pin = `__group_${direction}_${encodeURIComponent(signature)}`;
  const descriptors = descriptorsByGroup.get(group.id) || [];
  if (!descriptors.some((descriptor) => descriptor.pin === pin)) {
    descriptors.push({
      pin,
      rawPin: pin,
      direction,
      side,
      role: direction
    });
    descriptorsByGroup.set(group.id, descriptors);
  }
  return pin;
}
