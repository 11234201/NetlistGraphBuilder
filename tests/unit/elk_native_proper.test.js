import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanonicalGraph } from '../../src/layout/elk_native/ir.js';
import { orientGraph } from '../../src/layout/elk_native/p1_orientation.js';
import { assignLayers } from '../../src/layout/elk_native/p2_layering.js';
import { buildProperGraph } from '../../src/layout/elk_native/proper_graph.js';
import { validateProperGraph } from '../../src/layout/elk_native/validate_proper.js';
import { loadPhaseOracles, inputFromSnapshot } from '../helpers/elk_phase_inputs.js';

const corpus = await loadPhaseOracles();
const run = (input, options) => buildProperGraph(assignLayers(orientGraph(createCanonicalGraph(input))), options);
const sorted = (values) => values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

// Compare allocator-independent dummy/port/edge topology, including thickness and same-layer helpers.
function signature(nodes, edges, upstream = false) {
  const nodeKeys = new Map(nodes.map((node) => [node.id, node.kind === 'long_edge'
    ? JSON.stringify([node.lineage, node.layer, upstream ? node.box.height : node.height]) : node.id]));
  const ports = new Map(nodes.flatMap((node) => node.ports.map((port) => [port.id, node.kind === 'long_edge'
    ? `${nodeKeys.get(node.id)}:${port.side}` : port.id])));
  return {
    dummies: sorted(nodes.filter((node) => node.kind === 'long_edge').map((node) => ({
      key: nodeKeys.get(node.id), width: upstream ? node.box.width : node.width,
      ports: sorted(node.ports.map((port) => ({ side: port.side,
        x: upstream ? port.box.x : port.x, y: upstream ? port.box.y : port.y }))) }))),
    edges: sorted(edges.map((edge) => ({ logical: edge.logicalEdgeId, net: edge.physicalNetId,
      source: ports.get(edge.sourcePortId), target: ports.get(edge.targetPortId), reversed: edge.reversed })))
  };
}

test('elk_native proper split and inverted ports match six pinned processor graphs', () => {
  for (const oracle of corpus) for (const invertedPorts of [false, true]) {
    const upstream = oracle.snapshots.find((snapshot) => invertedPorts
      ? snapshot.processor.className?.endsWith('InvertedPortProcessor') : snapshot.boundary === 'long_edge_split');
    const result = run(inputFromSnapshot(oracle.snapshots[0]), { invertedPorts });
    assert.deepEqual(signature(result.nodes, result.edges), signature(
      upstream.components.flatMap((component) => component.nodes),
      upstream.components.flatMap((component) => component.edges), true), oracle.fixture.caseId);
    validateProperGraph(result);
  }
});

test('elk_native proper graph is immutable, permutation-stable and original ports stay unchanged', () => {
  for (const oracle of corpus) {
    const input = inputFromSnapshot(oracle.snapshots[0]), before = structuredClone(input);
    const result = run(input);
    assert.deepEqual(input, before);
    assert.ok(Object.isFrozen(result.chains[0].segmentIds));
    assert.deepEqual(run({ nodes: [...input.nodes].reverse().map((node) => ({ ...node,
      ports: [...node.ports].reverse() })), edges: [...input.edges].reverse() }), result);
    for (const node of result.nodes.filter((node) => node.kind === 'normal')) {
      assert.deepEqual(node.ports, createCanonicalGraph(input).nodes.find((entry) => entry.id === node.id).ports);
    }
  }
});

test('elk_native proper validation rejects broken topology and physical lineage', () => {
  const result = run(inputFromSnapshot(corpus[0].snapshots[0]));
  const broken = structuredClone(result);
  broken.edges[0].physicalNetId = 'foreign-net';
  assert.throws(() => validateProperGraph(broken), /broken-lineage/);
  const missing = structuredClone(result);
  missing.chains.pop();
  assert.throws(() => validateProperGraph(missing), /uncovered-lineage/);
  const span = structuredClone(result);
  span.nodes.find((node) => node.kind === 'long_edge' && node.dummyRole === 'span').layer += 1;
  assert.throws(() => validateProperGraph(span), /invalid-layer-member/);
});

test('elk_native proper graph carries edge thickness into intermediate port anchors', () => {
  const input = inputFromSnapshot(corpus.find((oracle) => oracle.fixture.caseId === 'reconvergent_long_edge').snapshots[0]);
  for (const edge of input.edges) edge.thickness = 3;
  const result = run(input);
  for (const dummy of result.nodes.filter((node) => node.kind === 'long_edge')) {
    assert.equal(dummy.height, 3);
    assert.ok(dummy.ports.every((port) => port.y === 1));
  }
  input.edges[0].thickness = -1;
  assert.throws(() => run(input), /invalid-edge-policy/);
});
