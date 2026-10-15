/** Deterministically orient strongly-connected components for layout only. */
export function BreakCycles(model) {
  const nodeKeys = model.nodes.map((node) => node.key);
  const outgoing = new Map(nodeKeys.map((key) => [key, []]));
  const incoming = new Map(nodeKeys.map((key) => [key, []]));
  for (const edge of model.logicalEdges) {
    outgoing.get(edge.sourceKey)?.push(edge.targetKey);
    incoming.get(edge.targetKey)?.push(edge.sourceKey);
  }
  SortAdjacency(outgoing);
  SortAdjacency(incoming);

  const finishOrder = BuildFinishOrder(nodeKeys, outgoing);
  const componentByNode = AssignComponents(finishOrder.toReversed(), incoming);
  const membersByComponent = new Map();
  for (const nodeKey of nodeKeys) {
    const component = componentByNode.get(nodeKey);
    const members = membersByComponent.get(component) || [];
    members.push(nodeKey);
    membersByComponent.set(component, members);
  }
  const positionInComponent = new Map();
  for (const members of membersByComponent.values()) {
    members.sort(CompareText).forEach((key, index) => positionInComponent.set(key, index));
  }

  const reversedEdgeKeys = [];
  const selfLoopEdgeKeys = [];
  const edges = model.logicalEdges.map((edge) => {
    const selfLoop = edge.sourceKey === edge.targetKey;
    const inCycle = componentByNode.get(edge.sourceKey) === componentByNode.get(edge.targetKey);
    const reversedForLayout = !selfLoop && inCycle &&
      positionInComponent.get(edge.sourceKey) > positionInComponent.get(edge.targetKey);
    if (selfLoop) selfLoopEdgeKeys.push(edge.key);
    if (reversedForLayout) reversedEdgeKeys.push(edge.key);
    return Object.freeze({
      ...edge,
      layoutSourceKey: reversedForLayout ? edge.targetKey : edge.sourceKey,
      layoutTargetKey: reversedForLayout ? edge.sourceKey : edge.targetKey,
      reversedForLayout,
      ignoredForLayering: selfLoop
    });
  });
  return Object.freeze({
    edges: Object.freeze(edges),
    reversedEdgeKeys: Object.freeze(reversedEdgeKeys),
    selfLoopEdgeKeys: Object.freeze(selfLoopEdgeKeys),
    componentByNode
  });
}

export function RestoreLayoutEdge(edge) {
  return Object.freeze({
    sourceKey: edge.sourceKey,
    targetKey: edge.targetKey,
    sourcePortKey: edge.sourcePortKey,
    targetPortKey: edge.targetPortKey,
    sourcePin: edge.sourcePin,
    targetPin: edge.targetPin
  });
}

function BuildFinishOrder(nodeKeys, adjacency) {
  const visited = new Set();
  const finished = [];
  for (const root of nodeKeys) {
    if (visited.has(root)) continue;
    visited.add(root);
    const stack = [{ key: root, cursor: 0 }];
    while (stack.length > 0) {
      const frame = stack.at(-1);
      const neighbors = adjacency.get(frame.key) || [];
      if (frame.cursor < neighbors.length) {
        const neighbor = neighbors[frame.cursor++];
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push({ key: neighbor, cursor: 0 });
        }
      } else {
        finished.push(frame.key);
        stack.pop();
      }
    }
  }
  return finished;
}

function AssignComponents(nodeKeys, adjacency) {
  const result = new Map();
  let component = 0;
  for (const root of nodeKeys) {
    if (result.has(root)) continue;
    result.set(root, component);
    const stack = [root];
    while (stack.length > 0) {
      const key = stack.pop();
      for (const neighbor of adjacency.get(key) || []) {
        if (result.has(neighbor)) continue;
        result.set(neighbor, component);
        stack.push(neighbor);
      }
    }
    component += 1;
  }
  return result;
}

function SortAdjacency(adjacency) {
  for (const values of adjacency.values()) values.sort(CompareText);
}

function CompareText(left, right) {
  return String(left).localeCompare(String(right));
}
