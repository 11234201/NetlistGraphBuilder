import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, '../../..');
const schema = JSON.parse(await readFile(path.join(repoRoot,
  'docs/design/elk-native-phase-snapshot.schema.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(repoRoot,
  'tests/fixtures/elk_parity/manifest.json'), 'utf8'));
const oraclePath = process.argv[2] ?? path.join(repoRoot,
  'tests/fixtures/elk_parity/oracles/oracle_smoke_001.elk.json');
const oracle = JSON.parse(await readFile(oraclePath, 'utf8'));

function check(value, definition, location) {
  if (definition.$ref) {
    const key = definition.$ref.split('/').at(-1);
    check(value, schema.$defs[key], location);
    return;
  }
  if (definition.const !== undefined) {
    assert.equal(value, definition.const, location);
  }
  if (definition.enum) {
    assert.ok(definition.enum.includes(value), `${location}: unknown enum ${value}`);
  }
  if (definition.type) {
    const types = Array.isArray(definition.type) ? definition.type : [definition.type];
    const matches = (type) => {
      if (type === 'null') return value === null;
      if (type === 'array') return Array.isArray(value);
      if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
      if (type === 'integer') return Number.isInteger(value);
      if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
      return typeof value === type;
    };
    assert.ok(types.some(matches), `${location}: expected ${types.join('|')}`);
  }
  if (definition.pattern) {
    assert.match(value, new RegExp(definition.pattern, 'u'), location);
  }
  if (definition.minLength !== undefined) {
    assert.ok(value.length >= definition.minLength, `${location}: too short`);
  }
  if (definition.minimum !== undefined && value !== null) {
    assert.ok(value >= definition.minimum, `${location}: below minimum`);
  }
  if (Array.isArray(value)) {
    if (definition.minItems !== undefined) {
      assert.ok(value.length >= definition.minItems, `${location}: too few items`);
    }
    if (definition.uniqueItems) {
      assert.equal(new Set(value.map((item) => JSON.stringify(item))).size,
        value.length, `${location}: duplicate items`);
    }
    if (definition.items) value.forEach((item, index) => check(item, definition.items, `${location}[${index}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const key of definition.required ?? []) {
      assert.ok(Object.hasOwn(value, key), `${location}: missing ${key}`);
    }
    for (const [key, item] of Object.entries(value)) {
      const property = definition.properties?.[key] ?? definition.additionalProperties;
      assert.notEqual(property, false, `${location}: unexpected ${key}`);
      if (property && property !== true) check(item, property, `${location}.${key}`);
    }
  }
}

check(oracle, schema, 'oracle');
assert.equal(oracle.producer.sourceCommit, manifest.upstream.commit);
assert.equal(oracle.fixture.manifestVersion, manifest.manifestVersion);
const fixtureCase = manifest.cases.find((entry) => entry.id === oracle.fixture.caseId);
assert.ok(fixtureCase);
const capturedInput = fixtureCase.oracleInput
  ? JSON.parse(await readFile(path.join(repoRoot, fixtureCase.oracleInput), 'utf8')) : null;
const inputGraph = capturedInput?.graph ?? fixtureCase.graph;
assert.equal(oracle.fixture.inputDigest, fixtureCase.inputDigest);
assert.deepEqual(oracle.run.options,
  { ...manifest.defaults, ...fixtureCase.options });
assert.ok(inputGraph, 'phase oracle case requires explicit graph input');
const imported = oracle.snapshots[0].components;
assert.deepEqual(imported.flatMap((component) => component.nodes.map((node) => node.id)).sort(),
  inputGraph.nodes.map((node) => node.id).sort(), 'imported node identity mismatch');
assert.deepEqual(imported.flatMap((component) => component.edges.map((edge) => edge.logicalEdgeId)).sort(),
  inputGraph.edges.map((edge) => edge.id).sort(), 'imported edge identity mismatch');
if (capturedInput) {
  const importedPorts = imported.flatMap((component) => component.nodes.flatMap((node) => node.ports));
  assert.deepEqual(importedPorts.map((port) => port.id).sort(),
    inputGraph.nodes.flatMap((node) => node.ports.map((port) => port.id)).sort(),
    'captured provider port identity mismatch');
  for (const inputEdge of inputGraph.edges) {
    const observed = imported.flatMap((component) => component.edges)
      .find((edge) => edge.logicalEdgeId === inputEdge.id);
    assert.equal(observed.sourcePortId, inputEdge.sourcePortId);
    assert.equal(observed.targetPortId, inputEdge.targetPortId);
  }
}
assert.ok(Object.keys(oracle.run.resolvedOptions).length >= 150,
  'resolved ELK option set is incomplete');
for (const option of ['org.eclipse.elk.layered.layering.strategy',
  'org.eclipse.elk.layered.crossingMinimization.strategy',
  'org.eclipse.elk.layered.nodePlacement.strategy',
  'org.eclipse.elk.edgeRouting']) {
  assert.ok(Object.hasOwn(oracle.run.resolvedOptions, option), `missing resolved ${option}`);
}

const milestones = new Set();
for (const [index, snapshot] of oracle.snapshots.entries()) {
  assert.equal(snapshot.ordinal, index);
  milestones.add(snapshot.boundary);
  const nodeCount = snapshot.components.reduce((sum, item) => sum + item.nodes.length, 0);
  const edgeCount = snapshot.components.reduce((sum, item) => sum + item.edges.length, 0);
  const layerCount = snapshot.components.reduce((sum, item) => sum + item.layers.length, 0);
  assert.equal(snapshot.metrics.nodeCount, nodeCount);
  assert.equal(snapshot.metrics.edgeCount, edgeCount);
  assert.equal(snapshot.metrics.layerCount, layerCount);
  for (const component of snapshot.components) {
    const nodeIds = new Set(component.nodes.map((node) => node.id));
    const ports = component.nodes.flatMap((node) => node.ports);
    const portIds = new Set(ports.map((port) => port.id));
    const edgeIds = new Set(component.edges.map((edge) => edge.id));
    assert.equal(nodeIds.size, component.nodes.length, 'duplicate node id');
    assert.equal(portIds.size, ports.length, 'duplicate port id');
    assert.equal(edgeIds.size, component.edges.length, 'duplicate edge id');
    for (const layer of component.layers) {
      layer.nodeIds.forEach((id) => assert.ok(nodeIds.has(id), `missing layered node ${id}`));
    }
    for (const port of ports) {
      assert.ok(nodeIds.has(port.nodeId), `missing port owner ${port.nodeId}`);
      [...port.incomingEdgeIds, ...port.outgoingEdgeIds].forEach((id) =>
        assert.ok(edgeIds.has(id), `missing port edge ${id}`));
    }
    for (const edge of component.edges) {
      assert.ok(portIds.has(edge.sourcePortId), `missing source port ${edge.sourcePortId}`);
      assert.ok(portIds.has(edge.targetPortId), `missing target port ${edge.targetPortId}`);
      const sourceEdge = inputGraph.edges.find((input) => input.id === edge.logicalEdgeId);
      assert.ok(sourceEdge, `edge ${edge.id} has no source lineage`);
      assert.equal(edge.physicalNetId, sourceEdge.physicalNet);
      assert.deepEqual(edge.lineage, [edge.logicalEdgeId]);
    }
    for (const node of component.nodes.filter((item) => item.kind !== 'normal')) {
      const incident = component.edges.filter((edge) => node.ports.some((port) =>
        edge.sourcePortId === port.id || edge.targetPortId === port.id));
      const expected = [...new Set(incident.map((edge) => edge.logicalEdgeId))].sort();
      assert.ok(expected.length > 0, `dummy ${node.id} has no incident source edge`);
      assert.deepEqual(node.lineage, expected, `dummy ${node.id} lineage mismatch`);
      for (const port of node.ports) {
        assert.equal(port.kind, 'dummy');
        const portEdges = incident.filter((edge) =>
          edge.sourcePortId === port.id || edge.targetPortId === port.id);
        assert.deepEqual(port.lineage,
          [...new Set(portEdges.map((edge) => edge.logicalEdgeId))].sort(),
          `dummy port ${port.id} lineage mismatch`);
      }
    }
  }
}

const requiredBoundaries = oracle.fixture.caseId === 'oracle_smoke_001'
  ? ['imported', 'p1', 'p2', 'long_edge_split', 'p3',
    'hyperedge_dummy_merge', 'p4', 'p5', 'restored', 'final']
  : ['imported', 'p1', 'p2', 'p3', 'p4', 'p5', 'final'];
for (const boundary of requiredBoundaries) {
  assert.ok(milestones.has(boundary), `missing ${boundary}`);
}
if (oracle.fixture.caseId === 'reconvergent_long_edge') {
  const split = oracle.snapshots.find((snapshot) => snapshot.boundary === 'long_edge_split');
  const dummies = split.components.flatMap((component) => component.nodes)
    .filter((node) => node.kind === 'long_edge');
  assert.ok(dummies.length >= 2, 'expected long-edge dummies after splitting');
  assert.ok(dummies.some((node) => node.lineage.includes('e_ad')),
    'direct long edge lost its dummy lineage');
  const restored = oracle.snapshots.find((snapshot) => snapshot.boundary === 'restored');
  assert.equal(restored.components.flatMap((component) => component.nodes)
    .filter((node) => node.kind === 'long_edge').length, 0,
  'long-edge dummies survived restoration');
}
if (oracle.fixture.caseId === 'multi_port_fanout_hyperedge') {
  for (const snapshot of [oracle.snapshots[0], oracle.snapshots.at(-1)]) {
    const fanout = snapshot.components.flatMap((component) => component.edges)
      .filter((edge) => edge.physicalNetId === 'n_fan');
    assert.equal(fanout.length, 4);
    assert.equal(new Set(fanout.map((edge) => edge.sourcePortId)).size, 1,
      'shared source port split into unrelated physical nets');
  }
  const afterP3 = oracle.snapshots.filter((snapshot) => snapshot.boundary === 'p3');
  for (const snapshot of afterP3) {
    const join = snapshot.components.flatMap((component) => component.nodes).find((node) => node.id === 'f');
    assert.deepEqual(join.ports.filter((port) => port.side === 'WEST').map((port) => port.id),
      ['f_in_e_ef', 'f_in_e_df', 'f_in_e_cf', 'f_in_e_bf'], 'fixed WEST clockwise order changed');
  }
}
if (oracle.fixture.caseId === 'sop015_5426_focused_3_3') {
  const selectEdge = inputGraph.edges.find((edge) => edge.source === 'cell:_5404_'
    && edge.target === 'cell:_5426_' && edge.targetPortId === 'cell:_5426_::input:S');
  assert.ok(selectEdge, '_5404_ to _5426_.S input lineage missing');
  const finalEdge = oracle.snapshots.at(-1).components.flatMap((component) => component.edges)
    .find((edge) => edge.logicalEdgeId === selectEdge.id);
  assert.equal(finalEdge.sourcePortId, selectEdge.sourcePortId);
  assert.equal(finalEdge.targetPortId, selectEdge.targetPortId);
  assert.equal(finalEdge.reversed, false);
}

const events = oracle.snapshots.flatMap((snapshot) => snapshot.phaseData.events ?? []);
const p2 = events.filter((event) => event.phase === 'p2'
  && event.event === 'network-simplex-result');
assert.equal(p2.length, 1, 'expected one P2 network-simplex result');
assert.ok(p2[0].nodes.length > 0 && p2[0].edges.length > 0);
assert.equal(p2[0].objectiveWeightedSpan,
  p2[0].edges.reduce((sum, edge) => sum + edge.weight * edge.actualSpan, 0));
const p3 = events.filter((event) => event.phase === 'p3');
assert.ok(p3.some((event) => event.event === 'candidate'), 'missing P3 sweep candidate');
for (const event of p3) {
  assert.equal(typeof event.crossings, 'number');
  assert.equal(typeof event.retained, 'boolean');
  assert.ok(event.layers.length > 0);
}
const p4 = events.filter((event) => event.phase === 'p4' && event.event === 'bk-candidates');
assert.equal(p4.length, 1, 'expected one BK candidate set');
assert.deepEqual(p4[0].candidates.map((candidate) => candidate.direction),
  ['RIGHTDOWN', 'RIGHTUP', 'LEFTDOWN', 'LEFTUP']);
assert.ok(p4[0].candidates.some((candidate) => candidate.direction === p4[0].selected.direction));
for (const candidate of p4[0].candidates) {
  assert.equal(candidate.root.length, candidate.y.length);
  assert.equal(candidate.align.length, candidate.y.length);
  assert.equal(candidate.innerShift.length, candidate.y.length);
}
const p5 = events.filter((event) => event.phase === 'p5' && event.event === 'boundary-state');
const p5ByLayer = new Map();
for (const event of p5) {
  const group = p5ByLayer.get(event.sourceLayerIndex) ?? [];
  group.push(event);
  p5ByLayer.set(event.sourceLayerIndex, group);
}
assert.ok(p5ByLayer.size >= 2, 'expected multiple P5 boundaries');
for (const boundaryEvents of p5ByLayer.values()) {
  assert.deepEqual(boundaryEvents.map((event) => event.stage),
    ['dependencies', 'after-critical', 'acyclic', 'slotted', 'routed']);
  assert.ok(Number.isInteger(boundaryEvents.at(-1).slotCount));
}
const p5Widths = events.filter((event) => event.phase === 'p5'
  && event.event === 'boundary-width');
assert.equal(p5Widths.length, p5ByLayer.size);
for (const width of p5Widths) {
  assert.equal(width.width, width.xAfter - width.xBefore);
  assert.ok(width.width >= 0);
  assert.ok(Number.isInteger(width.slotCount));
}

console.log(JSON.stringify({
  caseId: oracle.fixture.caseId,
  snapshots: oracle.snapshots.length,
  milestones: [...milestones].filter((entry) => entry !== 'processor'),
  p3Events: p3.length,
  p2Objective: p2[0].objectiveWeightedSpan,
  p4Candidates: p4[0].candidates.length,
  p5Boundaries: p5ByLayer.size,
  resolvedOptions: Object.keys(oracle.run.resolvedOptions).length,
  finalMetrics: oracle.snapshots.at(-1).metrics
}, null, 2));
