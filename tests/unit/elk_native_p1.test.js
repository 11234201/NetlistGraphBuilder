import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createCanonicalGraph } from '../../src/layout/elk_native/ir.js';
import { orientGraph } from '../../src/layout/elk_native/p1_orientation.js';
import { validateP1 } from '../../src/layout/elk_native/validate_p1.js';
import { inputDigest } from '../../src/layout/elk_native/input_digest.js';
import { loadPhaseOracles, inputFromSnapshot } from '../helpers/elk_phase_inputs.js';
const corpus = await loadPhaseOracles();

test('elk_native P0/P1 matches six pinned upstream orientation oracles', () => {
  for (const oracle of corpus) {
    const input = inputFromSnapshot(oracle.snapshots[0]);
    const before = structuredClone(input);
    const graph = createCanonicalGraph(input);
    const result = orientGraph(graph);
    const expected = oracle.snapshots.find((snapshot) => snapshot.boundary === 'p1');
    const owners = new Map(expected.components.flatMap((component) => component.nodes)
      .flatMap((node) => node.ports.map((port) => [port.id, node.id])));
    const observed = new Map(expected.components.flatMap((component) => component.edges)
      .map((edge) => [edge.logicalEdgeId, { source: owners.get(edge.sourcePortId),
        target: owners.get(edge.targetPortId), reversed: edge.reversed }]));
    for (const edge of result.edges) assert.deepEqual({ source: edge.sourceNodeId,
      target: edge.targetNodeId, reversed: edge.reversed }, observed.get(edge.id), oracle.fixture.caseId);
    assert.deepEqual(input, before);
    assert.ok(Object.isFrozen(graph) && Object.isFrozen(result));
    assert.ok(result.nodes.every((node) => Object.isFrozen(node) && Object.isFrozen(node.ports)));
    validateP1(result);
  }
});

test('elk_native input digest matches SHA-256 and Unicode reference vectors', () => {
  for (const text of ['', 'abc', 'a'.repeat(1000), 'cell:\\层次[7]\u0000net']) {
    assert.equal(inputDigest(text), `sha256:${createHash('sha256').update(text).digest('hex')}`);
  }
});

test('elk_native P0/P1 is invariant to node, edge and unordered port permutations', () => {
  for (const oracle of corpus) {
    const input = inputFromSnapshot(oracle.snapshots[0]);
    const expected = orientGraph(createCanonicalGraph(input));
    for (let shift = 0; shift < Math.min(8, input.nodes.length); shift++) {
      const permuted = { nodes: [...input.nodes.slice(shift), ...input.nodes.slice(0, shift)].reverse()
        .map((node) => ({ ...node, ports: [...node.ports].reverse() })),
      edges: [...input.edges.slice(shift), ...input.edges.slice(0, shift)].reverse() };
      assert.deepEqual(orientGraph(createCanonicalGraph(permuted)), expected, oracle.fixture.caseId);
    }
  }
});

function cyclicInput() {
  const nodes = ['a', 'b', 'c', 'isolated'].map((id) => ({ id, width: 40, height: 30,
    displayName: `\\${id}[7] `,
    ports: [{ id: `${id}:in`, side: 'WEST', x: 0, y: 15 },
      { id: `${id}:out`, side: 'EAST', x: 40, y: 15 }] }));
  const edge = (id, source, target, directionPriority = 0) => ({ id, physicalNetId: id,
    sourcePortId: `${source}:out`, targetPortId: `${target}:in`, directionPriority });
  return { nodes, edges: [edge('ab', 'a', 'b', 5), edge('bc', 'b', 'c'),
    edge('ca', 'c', 'a'), edge('loop', 'b', 'b')] };
}

test('elk_native greedy orientation honors edge priority and isolates self-loop lineage', () => {
  const input = cyclicInput();
  const graph = createCanonicalGraph(input);
  const result = orientGraph(graph);
  assert.deepEqual(result.selfLoops.map((edge) => edge.id), ['loop']);
  assert.equal(result.edges.find((edge) => edge.id === 'ab').reversed, false);
  assert.deepEqual(result.phaseData.feedbackEdges, ['ca']);
  for (const edge of result.edges) {
    assert.equal(edge.originalSourcePortId, input.edges.find((item) => item.id === edge.id).sourcePortId);
    assert.equal(edge.originalTargetPortId, input.edges.find((item) => item.id === edge.id).targetPortId);
  }
  assert.equal(result.nodes.find((node) => node.id === 'isolated').displayName, '\\isolated[7] ');
  assert.deepEqual(orientGraph(createCanonicalGraph({ nodes: [], edges: [] })).phaseData.order, []);
});

test('elk_native boundary rejects duplicate identities and invalid endpoint geometry', () => {
  const source = cyclicInput();
  assert.throws(() => createCanonicalGraph({ ...source, nodes: [...source.nodes, source.nodes[0]] }),
    (error) => error.diagnostic?.invariant === 'duplicate-node-id');
  assert.throws(() => createCanonicalGraph({ ...source, edges: [...source.edges, source.edges[0]] }),
    (error) => error.diagnostic?.invariant === 'duplicate-edge-id');
  assert.throws(() => createCanonicalGraph({ ...source, edges: [{ ...source.edges[0], targetPortId: 'missing' }] }),
    (error) => error.diagnostic?.invariant === 'missing-endpoint-port');
  assert.throws(() => createCanonicalGraph(source, { nodeNodeSpacing: Infinity }),
    (error) => error.diagnostic?.invariant === 'invalid-policy');
  const controller = new AbortController(); controller.abort();
  assert.throws(() => orientGraph(createCanonicalGraph(source), { signal: controller.signal }),
    { name: 'AbortError' });
});

test('elk_native phase code imports no old Native or vendored algorithm and contains no fixture policy', async () => {
  const directory = new URL('../../src/layout/elk_native/', import.meta.url);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.js'))) {
    const text = await readFile(new URL(file, directory), 'utf8');
    assert.doesNotMatch(text, /from\s+['"][^'"]*(?:native_layered|vendor|elkLayoutProvider)/u, file);
    assert.doesNotMatch(text, /sop015|eq012|_5426_|_5404_|groupGap|recursiveFocused/u, file);
  }
});
