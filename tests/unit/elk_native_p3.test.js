import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanonicalGraph } from '../../src/layout/elk_native/ir.js';
import { orientGraph } from '../../src/layout/elk_native/p1_orientation.js';
import { assignLayers } from '../../src/layout/elk_native/p2_layering.js';
import { buildProperGraph } from '../../src/layout/elk_native/proper_graph.js';
import { orderLayers } from '../../src/layout/elk_native/p3_ordering.js';
import { countCrossings } from '../../src/layout/elk_native/crossing_counter.js';
import { calculatePortRanks } from '../../src/layout/elk_native/port_ranks.js';
import { crossingContext } from '../../src/layout/elk_native/crossing_counter.js';
import { referenceCrossings } from '../reference/elk_native/crossing_reference.js';
import { resolveOrderConstraints } from '../../src/layout/elk_native/order_constraints.js';
import { loadPhaseOracles, inputFromSnapshot } from '../helpers/elk_phase_inputs.js';
const corpus = await loadPhaseOracles();
const proper = (input) => buildProperGraph(assignLayers(orientGraph(createCanonicalGraph(input))));

function upstreamGraph(snapshot) {
  const nodes = snapshot.components.flatMap((component) => component.nodes).map((node) => ({ ...node,
    ports: [...node.ports].sort((a, b) => a.order - b.order) }));
  const ports = new Map(nodes.flatMap((node) => node.ports.map((port) => [port.id, node])));
  const layers = Array.from({ length: snapshot.metrics.layerCount }, (_, index) => ({ index,
    nodeIds: nodes.filter((node) => node.layer === index).sort((a, b) => a.order - b.order).map((node) => node.id) }));
  const edges = snapshot.components.flatMap((component) => component.edges).map((edge) => ({ ...edge,
    sourceNodeId: ports.get(edge.sourcePortId).id, targetNodeId: ports.get(edge.targetPortId).id,
    segmentKind: ports.get(edge.sourcePortId).layer === ports.get(edge.targetPortId).layer ? 'inverted_port' : 'inter_layer' }));
  return { nodes, edges, layers };
}

test('elk_native crossing counter matches upstream retained P3 graphs', () => {
  for (const oracle of corpus) {
    const snapshot = oracle.snapshots.find((entry) => entry.boundary === 'p3');
    const expected = snapshot.phaseData.events.filter((event) => event.event === 'attempt' && event.retained).at(-1).crossings;
    assert.equal(countCrossings(upstreamGraph(snapshot)), expected, oracle.fixture.caseId);
  }
});

test('elk_native complete deterministic sweeps reach ELK crossing quality on six graphs', () => {
  for (const oracle of corpus) {
    const result = orderLayers(proper(inputFromSnapshot(oracle.snapshots[0])));
    const snapshot = oracle.snapshots.find((entry) => entry.boundary === 'p3');
    const expected = snapshot.phaseData.events.filter((event) => event.event === 'attempt' && event.retained).at(-1).crossings;
    assert.ok(result.phaseData.crossings <= expected, `${oracle.fixture.caseId}: ${result.phaseData.crossings} vs ${expected}`);
    assert.equal(result.phaseData.crossings, countCrossings(result));
    for (const node of result.nodes) assert.equal(result.layers[node.layer].nodeIds[node.order], node.id);
  }
});

test('elk_native sweep evidence and fixed ports survive permutations unchanged', () => {
  for (const oracle of corpus) {
    const input = inputFromSnapshot(oracle.snapshots[0]), graph = proper(input), result = orderLayers(graph);
    assert.deepEqual(orderLayers(proper({ nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse() })), result);
    for (const node of result.nodes) assert.deepEqual(node.ports, graph.nodes.find((entry) => entry.id === node.id).ports);
    const scores = new Map();
    for (const event of result.phaseData.events.filter((entry) => entry.event === 'candidate')) {
      const previous = scores.get(event.attempt) ?? Infinity;
      assert.equal(event.retained, event.crossings < previous);
      if (event.retained) scores.set(event.attempt, event.crossings);
    }
  }
});

test('elk_native fixed input ranks reverse WEST clockwise order in both models', () => {
  const graph = proper(inputFromSnapshot(corpus.find((entry) => entry.fixture.caseId === 'multi_port_fanout_hyperedge').snapshots[0]));
  const context = crossingContext(graph), node = graph.nodes.find((entry) => entry.id === 'f');
  for (const model of ['node_relative', 'layer_total']) {
    const ranks = calculatePortRanks(['f'], context, false, model);
    const clockwise = node.ports.filter((port) => port.side === 'WEST');
    assert.ok(clockwise.every((port, i) => i === 0 || ranks.get(clockwise[i - 1].id) > ranks.get(port.id)));
  }
});

test('elk_native indexed counter matches independent pair reference for many complete orders', () => {
  let seed = 8123;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (const oracle of corpus) {
    const graph = proper(inputFromSnapshot(oracle.snapshots[0]));
    for (let trial = 0; trial < 32; trial++) {
      const layers = graph.layers.map((layer) => ({ ...layer, nodeIds: [...layer.nodeIds] }));
      for (const layer of layers) for (let i = layer.nodeIds.length - 1; i > 0; i--) {
        const j = random() % (i + 1); [layer.nodeIds[i], layer.nodeIds[j]] = [layer.nodeIds[j], layer.nodeIds[i]];
      }
      const shuffled = { ...graph, layers };
      assert.equal(countCrossings(shuffled), referenceCrossings(shuffled), `${oracle.fixture.caseId}/${trial}`);
    }
  }
});

test('elk_native weighted successor groups resolve violations and reject cycles', () => {
  const states = new Map([['a', { sum: 4, degree: 2, value: 2 }],
    ['b', { sum: 0, degree: 1, value: 0 }], ['c', { sum: 3, degree: 2, value: 1.5 }]]);
  assert.deepEqual(resolveOrderConstraints(['b','c','a'], states, [{ before: 'a', after: 'b' }]), ['a','b','c']);
  assert.throws(() => resolveOrderConstraints(['b','c','a'], states,
    [{ before: 'a', after: 'b' }, { before: 'b', after: 'a' }]), /cyclic-order-constraint/);
});
