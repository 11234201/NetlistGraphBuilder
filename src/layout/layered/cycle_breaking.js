import { compareNodes } from "../nodePlacementShared.js";

export function orientCyclesForLayering(graph = {}) {
  const nodes = [...(graph.nodes || [])].toSorted(compareNodes);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [...(graph.edges || [])].toSorted(compareEdges);
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source).push(edge.target);
    incoming.get(edge.target).push(edge.source);
  }
  for (const neighbors of [...outgoing.values(), ...incoming.values()]) {
    neighbors.sort(compareIds);
  }

  const finishOrder = buildFinishOrder(nodes.map((node) => node.id), outgoing);
  const componentByNode = assignComponents(finishOrder.toReversed(), incoming);
  const membersByComponent = new Map();
  for (const node of nodes) {
    const component = componentByNode.get(node.id);
    const members = membersByComponent.get(component) || [];
    members.push(node.id);
    membersByComponent.set(component, members);
  }
  const rankInComponent = new Map();
  for (const members of membersByComponent.values()) {
    members.sort(compareIds).forEach((nodeId, index) => rankInComponent.set(nodeId, index));
  }

  const reversedEdgeIds = [];
  const selfLoopEdgeIds = [];
  const orientedEdges = edges.map((edge) => {
    const selfLoop = edge.source === edge.target;
    const sameComponent = componentByNode.get(edge.source) === componentByNode.get(edge.target);
    const reversedForLayout = !selfLoop && sameComponent &&
      rankInComponent.get(edge.source) > rankInComponent.get(edge.target);
    if (selfLoop) selfLoopEdgeIds.push(edge.id);
    if (reversedForLayout) reversedEdgeIds.push(edge.id);
    return {
      ...edge,
      source: reversedForLayout ? edge.target : edge.source,
      target: reversedForLayout ? edge.source : edge.target,
      originalSource: edge.source,
      originalTarget: edge.target,
      reversedForLayout,
      ignoredForLayering: selfLoop
    };
  });
  return { edges: orientedEdges, componentByNode, reversedEdgeIds, selfLoopEdgeIds };
}

export function restoreOrientedEdge(edge) {
  const {
    originalSource,
    originalTarget,
    reversedForLayout: _reversedForLayout,
    ignoredForLayering: _ignoredForLayering,
    ...rest
  } = edge;
  return {
    ...rest,
    source: originalSource ?? edge.source,
    target: originalTarget ?? edge.target
  };
}

function buildFinishOrder(nodeIds, adjacency) {
  const visited = new Set();
  const finished = [];
  for (const root of nodeIds) {
    if (visited.has(root)) continue;
    visited.add(root);
    const stack = [{ nodeId: root, cursor: 0 }];
    while (stack.length > 0) {
      const frame = stack.at(-1);
      const neighbors = adjacency.get(frame.nodeId) || [];
      if (frame.cursor < neighbors.length) {
        const neighbor = neighbors[frame.cursor];
        frame.cursor += 1;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push({ nodeId: neighbor, cursor: 0 });
        }
      } else {
        finished.push(frame.nodeId);
        stack.pop();
      }
    }
  }
  return finished;
}

function assignComponents(nodeIds, adjacency) {
  const componentByNode = new Map();
  let component = 0;
  for (const root of nodeIds) {
    if (componentByNode.has(root)) continue;
    componentByNode.set(root, component);
    const stack = [root];
    while (stack.length > 0) {
      const nodeId = stack.pop();
      for (const neighbor of adjacency.get(nodeId) || []) {
        if (componentByNode.has(neighbor)) continue;
        componentByNode.set(neighbor, component);
        stack.push(neighbor);
      }
    }
    component += 1;
  }
  return componentByNode;
}

function compareEdges(left, right) {
  return compareIds(left.source, right.source) || compareIds(left.target, right.target) ||
    compareIds(left.id, right.id);
}

function compareIds(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}
