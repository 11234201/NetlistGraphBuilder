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
  return { ...graph, nodes, edges, groups, collapsedGroupCount: collapsedGroups.length };
}
