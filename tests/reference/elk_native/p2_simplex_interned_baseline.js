import { PhaseError, compareIds, checkCancelled } from '../../../src/layout/elk_native/protocol.js';

export const SUBTREE_PEEL_NODE_THRESHOLD = 40;
const NEGATIVE_CUT_TOLERANCE = -1e-10;
const slack = (edge, ranks) => ranks.get(edge.targetNodeId) - ranks.get(edge.sourceNodeId) - edge.minimumLength;
const otherEnd = (edge, id) => edge.sourceNodeId === id ? edge.targetNodeId : edge.sourceNodeId;

function adjacency(ids, edges) {
  const result = new Map(ids.map((id) => [id, []]));
  for (const edge of edges) {
    result.get(edge.sourceNodeId).push(edge);
    result.get(edge.targetNodeId).push(edge);
  }
  return result;
}

function peelSubtrees(ids, edges) {
  if (ids.length < SUBTREE_PEEL_NODE_THRESHOLD) return { ids, edges, peeled: [] };
  const incident = adjacency(ids, edges);
  const active = new Set(edges.map((edge) => edge.id));
  const remaining = new Set(ids), degree = new Map(ids.map((id) => [id, incident.get(id).length]));
  const queue = ids.filter((id) => degree.get(id) === 1), peeled = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    if (!remaining.has(id) || degree.get(id) === 0) continue;
    const edge = incident.get(id).find((item) => active.has(item.id));
    const neighbor = otherEnd(edge, id);
    remaining.delete(id); active.delete(edge.id); degree.set(id, 0);
    degree.set(neighbor, degree.get(neighbor) - 1);
    if (degree.get(neighbor) === 1) queue.push(neighbor);
    peeled.push({ nodeId: id, neighborId: neighbor, edge });
  }
  return { ids: ids.filter((id) => remaining.has(id)), edges: edges.filter((edge) => active.has(edge.id)), peeled };
}

function initialRanks(ids, edges) {
  const ranks = new Map(ids.map((id) => [id, 0]));
  const incoming = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map(ids.map((id) => [id, []]));
  for (const edge of edges) {
    incoming.set(edge.targetNodeId, incoming.get(edge.targetNodeId) + 1);
    outgoing.get(edge.sourceNodeId).push(edge);
  }
  const queue = ids.filter((id) => incoming.get(id) === 0);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    for (const edge of outgoing.get(id)) {
      ranks.set(edge.targetNodeId, Math.max(ranks.get(edge.targetNodeId), ranks.get(id) + edge.minimumLength));
      incoming.set(edge.targetNodeId, incoming.get(edge.targetNodeId) - 1);
      if (incoming.get(edge.targetNodeId) === 0) queue.push(edge.targetNodeId);
    }
  }
  if (queue.length !== ids.length) throw new PhaseError('p2', 'input-cycle');
  return ranks;
}

function growTightTree(ids, edges, ranks, signal) {
  const incident = adjacency(ids, edges), tree = new Map();
  let reached;
  // Each extension adds at least one node, so this is bounded by component size.
  for (let extension = 0; extension < ids.length; extension++) {
    checkCancelled(signal);
    // Rebuild the DFS tree of the current tight subgraph. Newly tight chords
    // can displace an old DFS edge; retaining that unvisited edge creates a cycle.
    tree.clear();
    reached = new Set([ids[0]]);
    const stack = [{ id: ids[0], next: 0 }];
    while (stack.length) {
      const frame = stack.at(-1), connected = incident.get(frame.id);
      if (frame.next === connected.length) { stack.pop(); continue; }
      const edge = connected[frame.next++], other = otherEnd(edge, frame.id);
      if (reached.has(other) || slack(edge, ranks) !== 0) continue;
      reached.add(other); tree.set(edge.id, edge); stack.push({ id: other, next: 0 });
    }
    if (reached.size === ids.length) return tree;
    let entering = null, minimum = Infinity;
    for (const edge of edges) if (reached.has(edge.sourceNodeId) !== reached.has(edge.targetNodeId)) {
      const value = slack(edge, ranks);
      if (value < minimum) { minimum = value; entering = edge; }
    }
    if (!entering) throw new PhaseError('p2', 'disconnected-tight-tree');
    const shift = reached.has(entering.sourceNodeId) ? minimum : -minimum;
    for (const id of reached) ranks.set(id, ranks.get(id) + shift);
  }
  throw new PhaseError('p2', 'tight-tree-progress');
}

function treeState(ids, edges, tree) {
  const incident = adjacency(ids, [...tree.values()]);
  const parent = new Map(), parentEdge = new Map(), order = [], index = new Map();
  const stack = [ids[0]]; parent.set(ids[0], null);
  while (stack.length) {
    const id = stack.pop(); index.set(id, order.length); order.push(id);
    const childEdges = incident.get(id).filter((edge) => otherEnd(edge, id) !== parent.get(id));
    for (let i = childEdges.length - 1; i >= 0; i--) {
      const edge = childEdges[i], child = otherEnd(edge, id);
      if (parent.has(child)) throw new PhaseError('p2', 'tree-cycle');
      parent.set(child, id); parentEdge.set(child, edge); stack.push(child);
    }
  }
  if (order.length !== ids.length) throw new PhaseError('p2', 'tree-not-spanning');
  const divergence = new Map(ids.map((id) => [id, 0]));
  for (const edge of edges) {
    divergence.set(edge.sourceNodeId, divergence.get(edge.sourceNodeId) - edge.weight);
    divergence.set(edge.targetNodeId, divergence.get(edge.targetNodeId) + edge.weight);
  }
  const size = new Map(ids.map((id) => [id, 1])), cuts = new Map(), childByEdge = new Map();
  for (let i = order.length - 1; i > 0; i--) {
    const id = order[i], edge = parentEdge.get(id), p = parent.get(id);
    cuts.set(edge.id, edge.targetNodeId === id ? divergence.get(id) : -divergence.get(id));
    childByEdge.set(edge.id, id);
    size.set(p, size.get(p) + size.get(id));
    divergence.set(p, divergence.get(p) + divergence.get(id));
  }
  return { cuts, inHead: (id, edge) => {
    const child = childByEdge.get(edge.id);
    const inSubtree = index.get(id) >= index.get(child) && index.get(id) < index.get(child) + size.get(child);
    return edge.targetNodeId === child ? inSubtree : !inSubtree;
  } };
}

function balance(ids, edges, ranks, previousProfile) {
  const incident = adjacency(ids, edges), count = [];
  for (const rank of ranks.values()) count[rank] = (count[rank] ?? 0) + 1;
  for (let i = 0; i < count.length; i++) count[i] = (count[i] ?? 0) + (previousProfile[i] ?? 0);
  const shifts = [];
  for (const id of ids) {
    const incoming = incident.get(id).filter((edge) => edge.targetNodeId === id);
    const outgoing = incident.get(id).filter((edge) => edge.sourceNodeId === id);
    // Weighted equality is required for objective preservation when priorities differ.
    if (incoming.reduce((sum, edge) => sum + edge.weight, 0)
      !== outgoing.reduce((sum, edge) => sum + edge.weight, 0)) continue;
    const lower = Math.max(0, ...incoming.map((edge) => ranks.get(edge.sourceNodeId) + edge.minimumLength));
    const upper = Math.min(count.length - 1,
      ...outgoing.map((edge) => ranks.get(edge.targetNodeId) - edge.minimumLength));
    const from = ranks.get(id);
    let to = from;
    for (let rank = lower; rank <= upper; rank++) if (count[rank] < count[to]) to = rank;
    if (to !== from) { count[from]--; count[to]++; ranks.set(id, to); shifts.push({ nodeId: id, from, to }); }
  }
  return shifts;
}

// Independent tight-tree simplex formulation, following the pinned ELK objective and
// first-negative / first-minimum policies. Cut values use subtree divergence sums.
function optimizeIndexedRanks(nodeIds, componentEdges, options, previousProfile = [], { signal } = {}) {
  const ids = [...nodeIds].sort(compareIds), edges = [...componentEdges].sort((a, b) => compareIds(a.id, b.id));
  checkCancelled(signal);
  const reduced = peelSubtrees(ids, edges);
  const ranks = initialRanks(reduced.ids, reduced.edges);
  const initial = [...ranks].map(([nodeId, rank]) => ({ nodeId, rank }));
  const tree = growTightTree(reduced.ids, reduced.edges, ranks, signal);
  const iterationLimit = options.thoroughness * 4 * Math.floor(Math.sqrt(ids.length));
  const pivots = [];
  let state = treeState(reduced.ids, reduced.edges, tree);
  while (true) {
    checkCancelled(signal);
    const leaving = [...tree.values()].find((edge) => state.cuts.get(edge.id) < NEGATIVE_CUT_TOLERANCE);
    if (!leaving) break;
    // Like the pinned upstream bounded loop, retain the feasible tight-tree
    // solution at the budget. Do not claim optimality while negative cuts remain.
    if (pivots.length >= iterationLimit) break;
    let entering = null, minimum = Infinity;
    for (const edge of reduced.edges) if (!tree.has(edge.id)
      && state.inHead(edge.sourceNodeId, leaving) && !state.inHead(edge.targetNodeId, leaving)) {
      const value = slack(edge, ranks);
      if (value < minimum) { entering = edge; minimum = value; }
    }
    if (!entering) throw new PhaseError('p2', 'negative-cut-without-entering-edge', [leaving.id]);
    for (const id of reduced.ids) if (state.inHead(id, leaving)) ranks.set(id, ranks.get(id) + minimum);
    pivots.push({ leaveEdgeId: leaving.id, enterEdgeId: entering.id,
      cutValue: state.cuts.get(leaving.id), shift: minimum });
    tree.delete(leaving.id); tree.set(entering.id, entering);
    state = treeState(reduced.ids, reduced.edges, tree);
  }
  const balancingOrder = [...reduced.ids];
  for (const { nodeId, neighborId, edge } of [...reduced.peeled].reverse()) {
    ranks.set(nodeId, ranks.get(neighborId) + (edge.targetNodeId === nodeId ? edge.minimumLength : -edge.minimumLength));
    balancingOrder.push(nodeId);
  }
  const minimumRank = Math.min(...ranks.values());
  for (const [id, rank] of ranks) ranks.set(id, rank - minimumRank);
  const balancing = options.balanceLayers ? balance(balancingOrder, edges, ranks, previousProfile) : [];
  const objectiveWeightedSpan = edges.reduce((sum, edge) => sum + edge.weight
    * (ranks.get(edge.targetNodeId) - ranks.get(edge.sourceNodeId)), 0);
  const negativeCutCount=[...state.cuts.values()].filter((cut)=>cut<NEGATIVE_CUT_TOLERANCE).length;
  return { ranks, evidence: { nodeIds: ids, initialRanks: initial, objectiveWeightedSpan, iterationLimit,
    optimal:negativeCutCount===0,termination:negativeCutCount===0?'optimal':'iteration-limit',
    pivotCount:pivots.length,zeroShiftCount:pivots.filter((pivot)=>pivot.shift===0).length,negativeCutCount,
    treeEdges: [...tree.keys()], cutValues: [...tree].map(([edgeId]) => ({ edgeId, cutValue: state.cuts.get(edgeId) })),
    pivots, peeledNodeIds: reduced.peeled.map((item) => item.nodeId), balancing } };
}

// Canonical ordering is established before interning. Integer identities only
// replace repeated hashing of external IDs; all simplex choices remain intact.
export function optimizeRanks(nodeIds, componentEdges, options, previousProfile = [], { signal } = {}) {
  checkCancelled(signal);
  const ids=[...nodeIds].sort(compareIds);
  const edges=[...componentEdges].sort((a,b)=>compareIds(a.id,b.id));
  const nodeIndex=new Map(ids.map((id,index)=>[id,index]));
  const indexedEdges=edges.map((edge,index)=>({...edge,id:index,
    sourceNodeId:nodeIndex.get(edge.sourceNodeId),targetNodeId:nodeIndex.get(edge.targetNodeId)}));
  let result;
  try {
    result=optimizeIndexedRanks(ids.map((_,index)=>index),indexedEdges,options,previousProfile,{signal});
  } catch(error) {
    if(error instanceof PhaseError && error.diagnostic.entityIds.length) {
      throw new PhaseError(error.diagnostic.phase,error.diagnostic.invariant,
        error.diagnostic.entityIds.map((index)=>edges[index].id),error.diagnostic.detail);
    }
    throw error;
  }
  const evidence=result.evidence;
  return {ranks:new Map([...result.ranks].map(([index,rank])=>[ids[index],rank])),evidence:{...evidence,
    nodeIds:evidence.nodeIds.map((index)=>ids[index]),
    initialRanks:evidence.initialRanks.map((entry)=>({...entry,nodeId:ids[entry.nodeId]})),
    treeEdges:evidence.treeEdges.map((index)=>edges[index].id),
    cutValues:evidence.cutValues.map((entry)=>({...entry,edgeId:edges[entry.edgeId].id})),
    pivots:evidence.pivots.map((entry)=>({...entry,leaveEdgeId:edges[entry.leaveEdgeId].id,
      enterEdgeId:edges[entry.enterEdgeId].id})),
    peeledNodeIds:evidence.peeledNodeIds.map((index)=>ids[index]),
    balancing:evidence.balancing.map((entry)=>({...entry,nodeId:ids[entry.nodeId]}))}};
}


