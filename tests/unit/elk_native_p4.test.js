import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanonicalGraph } from '../../src/layout/elk_native/ir.js';
import { orientGraph } from '../../src/layout/elk_native/p1_orientation.js';
import { assignLayers } from '../../src/layout/elk_native/p2_layering.js';
import { buildProperGraph } from '../../src/layout/elk_native/proper_graph.js';
import { orderLayers } from '../../src/layout/elk_native/p3_ordering.js';
import { mergeHyperedgeDummies } from '../../src/layout/elk_native/hyperedge_merge.js';
import { placeNodes } from '../../src/layout/elk_native/p4_placement.js';
import { verticalSpacing } from '../../src/layout/elk_native/bk_alignment.js';
import { validateP4 } from '../../src/layout/elk_native/validate_p4.js';
import { loadPhaseOracles, inputFromSnapshot } from '../helpers/elk_phase_inputs.js';
const corpus = await loadPhaseOracles();
const proper = (input, options) => buildProperGraph(assignLayers(orientGraph(createCanonicalGraph(input, options))));
function oracleOrder(oracle) {
  const graph = proper(inputFromSnapshot(oracle.snapshots[0]), {
    nodeNodeSpacing: oracle.run.resolvedOptions['org.eclipse.elk.spacing.nodeNode'] });
  const upstream = oracle.snapshots.find((snapshot) => snapshot.boundary === 'p4');
  const source = upstream.components.flatMap((component) => component.nodes);
  const key = (node, raw = false) => node.kind === 'long_edge'
    ? JSON.stringify([node.lineage, node.layer, raw ? node.box.height : node.height]) : node.id;
  const byKey = new Map(graph.nodes.map((node) => [key(node), node.id]));
  const mapping = new Map(source.map((node) => [node.id, byKey.get(key(node, true))]));
  const ordered = { ...graph, nodes: graph.nodes.map((node) => {
    const upstreamNode = source.find((entry) => mapping.get(entry.id) === node.id);
    return { ...node, order: upstreamNode.order, margins: upstreamNode.margins };
  }), layers: graph.layers.map((layer) => ({ index: layer.index,
    nodeIds: source.filter((node) => node.layer === layer.index).sort((a,b) => a.order-b.order).map((node) => mapping.get(node.id)) })) };
  return { graph: ordered, source, mapping, upstream };
}

test('elk_native four BK candidates match pinned fixed-order phase y coordinates', () => {
  for (const oracle of corpus) {
    const { graph, source, mapping, upstream } = oracleOrder(oracle);
    const result = placeNodes(graph), expected = upstream.phaseData.events.find((event) => event.event === 'bk-candidates');
    assert.equal(result.phaseData.candidates.length, 4);
    for (const candidate of result.phaseData.candidates) {
      const reference = expected.candidates.find((entry) => entry.direction === candidate.direction);
      assert.equal(candidate.feasible, reference.feasible, `${oracle.fixture.caseId}/${candidate.direction}`);
      assert.ok(Math.abs(candidate.size - reference.size) < 1e-7,
        `${oracle.fixture.caseId}/${candidate.direction}: ${candidate.size} vs ${reference.size}`);
      const indexedIds = graph.layers.flatMap((layer) => layer.nodeIds);
      for (const field of ['root', 'align', 'sink']) {
        const actual = new Map(candidate[field]);
        assert.deepEqual(indexedIds.map((id) => actual.get(id)), reference[field].map((value) =>
          indexedIds[Number.parseInt(value, 10)]), `${oracle.fixture.caseId}/${candidate.direction}/${field}`);
      }
      for (const field of ['innerShift', 'blockSize', 'shift', 'y']) {
        const actual = new Map(candidate[field]);
        assert.deepEqual(indexedIds.map((id) => actual.get(id) ?? null), reference[field].map((value) =>
          value === 'Infinity' ? Infinity : value === '-Infinity' ? -Infinity : value),
        `${oracle.fixture.caseId}/${candidate.direction}/${field}`);
      }
    }
    for (const node of source) {
      const actual = result.nodes.find((entry) => entry.id === mapping.get(node.id));
      assert.ok(Math.abs(actual.y - node.box.y) < 1e-7, `${oracle.fixture.caseId}/${node.id}: ${actual.y} vs ${node.box.y}`);
    }
  }
});

test('elk_native actual P1-P4 pipeline is feasible and permutation-stable without packing', () => {
  for (const oracle of corpus) {
    const input = inputFromSnapshot(oracle.snapshots[0]);
    const run = (data) => placeNodes(mergeHyperedgeDummies(orderLayers(proper(data))));
    const result = run(input);
    assert.deepEqual(run({ nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse() }), result);
    const nodes = new Map(result.nodes.map((node) => [node.id,node]));
    for (const layer of result.layers) for (let i=1; i<layer.nodeIds.length; i++) {
      const above=nodes.get(layer.nodeIds[i-1]), below=nodes.get(layer.nodeIds[i]);
      assert.ok(below.y-below.margins.top >= above.y+above.height+above.margins.bottom
        +verticalSpacing(above,below,result.options)-1e-7);
    }
  }
});

test('elk_native adjacent shared-net dummies merge with one-to-many immutable chains', () => {
  const nodes = ['a','b','c','d'].map((id) => ({ id, width: 40, height: 30, ports: [
    { id: `${id}:in`, side: 'WEST', x: 0, y: 15 }, { id: `${id}:out`, side: 'EAST', x: 40, y: 15 }] }));
  const edges = [['a','b'],['b','c'],['c','d'],['a','c'],['a','d']].map(([a,b]) => ({
    id: `${a}-${b}`, physicalNetId: `net:${a}`, sourcePortId: `${a}:out`, targetPortId: `${b}:in` }));
  const graph = proper({ nodes, edges });
  const ordered = { ...graph, layers: graph.layers.map((layer) => ({ ...layer,
    nodeIds: [...layer.nodeIds].sort((a,b) => Number(a.startsWith('dummy:')) - Number(b.startsWith('dummy:'))) })) };
  const merged = mergeHyperedgeDummies(ordered);
  assert.equal(merged.mergeEquivalences.length, 1);
  assert.equal(merged.nodes.length, graph.nodes.length - 1);
  assert.equal(merged.edges.length, graph.edges.length);
  assert.equal(graph.nodes.filter((node) => node.lineage?.length > 1).length, 0);
  assert.ok(merged.nodes.some((node) => node.lineage?.length === 2));
  assert.ok(Object.isFrozen(merged.mergeEquivalences[0].logicalEdgeIds));
  validateP4(placeNodes(merged));
});

test('elk_native P4 rejects overlap corruption and balanced policy preserves spacing', () => {
  const { graph } = oracleOrder(corpus[0]);
  const result = placeNodes({ ...graph, options: { ...graph.options, favorStraightEdges: false } });
  validateP4(result);
  const broken = structuredClone(result);
  const layer = broken.layers.find((entry) => entry.nodeIds.length > 1);
  for (const id of layer.nodeIds) broken.nodes.find((node) => node.id === id).y = 0;
  assert.throws(() => validateP4(broken), /spacing-order-violation/);
});
