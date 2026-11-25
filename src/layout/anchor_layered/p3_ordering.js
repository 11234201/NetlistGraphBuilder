import { compareIds, freezeRecord, checkCancelled, PhaseError } from './protocol.js';
import { validateProperGraph } from './validate_proper.js';
import { crossingContext, createSweepCrossingCounter } from './crossing_counter.js';
import { calculatePortRanks } from './port_ranks.js';
import { resolveOrderConstraints } from './order_constraints.js';
import {cohereBandIds,cohereLayoutUnits} from './group_sweep.js';

// Source-visible 0.07 perturbation, named here rather than mixed into arbitrary costs.
const BARYCENTER_PERTURBATION = 0.07;
const copyLayers = (layers) => layers.map((ids) => [...ids]);
function randomStream(digest, seed) {
  let state = (Number.parseInt(digest.slice(-8), 16) ^ seed) >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

// Port order and within-layer dependencies are fixed throughout a P3 run.
function prepareSweep(context, forward) {
  const dependencies = forward ? context.incoming : context.outgoing;
  const ranked = forward ? context.outgoing : context.incoming;
  const sweep = new Map();
  for (const node of context.nodes.values()) {
    const rankPorts = [], neighbors = [];
    let hasLocal = false;
    for (const port of node.ports) {
      if (ranked.get(port.id).length) rankPorts.push(port);
      for (const edge of dependencies.get(port.id)) {
        const other = forward ? edge.sourceNodeId : edge.targetNodeId;
        const local = context.nodes.get(other).layer === node.layer;
        neighbors.push({ local, id: local ? other : forward ? edge.sourcePortId : edge.targetPortId });
        hasLocal ||= local;
      }
    }
    sweep.set(node.id, { rankPorts, neighbors, hasLocal });
  }
  return sweep;
}

function sortFreeLayer(layers, index, forward, first, model, context, sweep, random, constraints, groupContext, layoutUnits) {
  const ids = layers[index], ranks = calculatePortRanks(layers[index + (forward ? -1 : 1)], context, forward, model, sweep);
  const states = new Map(), visiting = new Set();
  const calculate = (id) => {
    if (states.has(id)) return states.get(id);
    const { neighbors, hasLocal } = sweep.get(id);
    if (hasLocal) {
      if (visiting.has(id)) throw new PhaseError('p3', 'in-layer-cycle', [id]);
      visiting.add(id);
    }
    const state = { sum: 0, degree: 0, value: null };
    for (const neighbor of neighbors) {
      if (neighbor.local) {
        const other = calculate(neighbor.id); state.sum += other.sum; state.degree += other.degree;
      } else {
        state.sum += ranks.get(neighbor.id); state.degree++;
      }
    }
    if (state.degree) {
      state.sum += (random() - 0.5) * BARYCENTER_PERTURBATION;
      state.value = state.sum / state.degree;
    }
    if (hasLocal) visiting.delete(id);
    states.set(id, state); return state;
  };
  for (const id of ids) calculate(id);
  if (first) {
    let maximum = 0;
    for (const state of states.values()) maximum = Math.max(maximum, state.value ?? 0);
    maximum += 2;
    for (const id of ids) if (states.get(id).value === null) states.get(id).value = random() * maximum - 1;
  } else {
    // Suffix next-known table preserves ELK's interpolation without quadratic forward scans.
    const nextValues = new Array(ids.length); let next = null;
    for (let i = ids.length - 1; i >= 0; i--) { nextValues[i] = next; if (states.get(ids[i]).value !== null) next = states.get(ids[i]).value; }
    let previous = -1;
    for (let i = 0; i < ids.length; i++) {
      const state = states.get(ids[i]);
      if (state.value === null) state.value = (previous + (nextValues[i] ?? previous + 1)) / 2;
      previous = state.value;
    }
  }
  // Stable sort preserves the preceding order for equal barycenters.
  ids.sort((a, b) => states.get(a).value - states.get(b).value);
  const grouped=groupContext?(layoutUnits?cohereLayoutUnits:cohereBandIds)(ids,states,groupContext.bandsByRank.get(index)??[]):ids;
  layers[index] = resolveOrderConstraints(grouped, states, constraints);
}

export function orderLayers(input, { signal, observe = true, orderingDigest, groupContext, layoutUnits = false } = {}) {
  validateProperGraph(input);
  for (const node of input.nodes) for (const port of node.ports) {
    if (!['WEST', 'EAST'].includes(port.side)) throw new PhaseError('p3', 'unsupported-flat-port-side', [port.id]);
  }
  const context = crossingContext(input, { cacheMutableQueries: false });
  const random = randomStream(orderingDigest ?? input.inputDigest, input.options.randomSeed);
  const sweeps = [prepareSweep(context, false), prepareSweep(context, true)];
  const scoreLayers = createSweepCrossingCounter(input, context);
  const constraints = input.orderConstraints ?? [];
  for (const { before, after } of constraints) {
    if (!context.nodes.has(before) || !context.nodes.has(after)
      || context.nodes.get(before).layer !== context.nodes.get(after).layer) {
      throw new PhaseError('p3', 'invalid-order-constraint', [before, after]);
    }
  }
  let current = input.layers.map((layer) => [...layer.nodeIds]);
  current = current.map((ids) => resolveOrderConstraints(ids,
    new Map(ids.map((id, position) => [id, { sum: position, degree: 1, value: position }])), constraints));
  let best = copyLayers(current), bestScore = scoreLayers(current);
  const events = [];
  if (current.length > 1) for (let attempt = 0; attempt < input.options.thoroughness; attempt++) {
    checkCancelled(signal);
    const model = attempt % 2 ? 'layer_total' : 'node_relative';
    let forward = random() < 0.5;
    const firstIndex = forward ? 0 : current.length - 1;
    const values = new Map(current[firstIndex].map((id) => [id, random()]));
    current[firstIndex].sort((a, b) => values.get(a) - values.get(b) || compareIds(a, b));
    if(groupContext)current[firstIndex]=(layoutUnits?cohereLayoutUnits:cohereBandIds)(current[firstIndex],
      new Map([...values].map(([id,value])=>[id,{value,degree:1}])),groupContext.bandsByRank.get(firstIndex)??[]);
    current[firstIndex] = resolveOrderConstraints(current[firstIndex],
      new Map([...values].map(([id, value]) => [id, { sum: value, degree: 1, value }])), constraints);
    let retained = null, retainedScore = Infinity;
    let first = true;
    // Only strictly decreasing complete sweeps continue: integer crossing score supplies a termination proof.
    while (true) {
      checkCancelled(signal);
      for (let index = forward ? 1 : current.length - 2; forward ? index < current.length : index >= 0;
        index += forward ? 1 : -1) sortFreeLayer(current, index, forward, first, model, context, sweeps[Number(forward)], random, constraints, groupContext, layoutUnits);
      const score = scoreLayers(current);
      const improves = score < retainedScore;
      if (observe) events.push({ event: 'candidate', attempt, model, forward, crossings: score, retained: improves,
        layers: copyLayers(current) });
      if (!improves) { current = retained; break; }
      retained = copyLayers(current); retainedScore = score;
      if (score === 0) break;
      forward = !forward; first = false;
    }
    const improves = retainedScore < bestScore || retainedScore === bestScore
      && compareIds(JSON.stringify(retained), JSON.stringify(best)) < 0;
    if (observe) events.push({ event: 'attempt', attempt, model, crossings: retainedScore, retained: improves });
    if (improves) { best = copyLayers(retained); bestScore = retainedScore; }
    current = copyLayers(retained);
    if (bestScore === 0) break;
  }
  const positions = new Map(best.flatMap((ids) => ids.map((id, order) => [id, order])));
  if (constraints.some(({ before, after }) => positions.get(before) >= positions.get(after))) {
    throw new PhaseError('p3', 'unsatisfied-order-constraint');
  }
  const result = { ...input, phase: 'p3', nodes: input.nodes.map((node) => ({ ...node, order: positions.get(node.id) })),
    layers: best.map((nodeIds, index) => ({ index, nodeIds })), phaseData: { crossings: bestScore, events,
      perturbationKey: `${orderingDigest ?? input.inputDigest}:${input.options.randomSeed}`,
      portOrders: input.nodes.map((node) => ({ nodeId: node.id, portIds: node.ports.map((port) => port.id) })) } };
  validateProperGraph(result);
  return freezeRecord(result);
}
