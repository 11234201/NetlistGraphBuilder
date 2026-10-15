import assert from 'node:assert/strict';
import test from 'node:test';
import {connectPhysicalAnchors} from '../../src/layout/elk_native/physical_anchor_adjacency.js';
import {connectPhysicalAnchors as researchAnchors} from '../../tools/research/elk_phase_oracle/physical_anchor_routing.mjs';

test('research and static physical-anchor policies share one implementation and stable star links', () => {
  assert.equal(researchAnchors, connectPhysicalAnchors);
  const ids = ['z', 'a', '中', 'A'];
  const ports = new Map(ids.map(id => [id, {nodeId: 'node', side: 'EAST', x: 20,
    y: 10, anchor: {x: 0, y: 0}}]));
  const edges = ids.map(id => ({id, physicalNetId: 'net', sourcePortId: id, targetPortId: id}));
  const adjacency = new Map(ids.map(id => [id, []]));
  const before = structuredClone({ports, edges});
  assert.deepEqual(connectPhysicalAnchors(edges, ports, adjacency), {groupCount: 1, linkCount: 3});
  assert.deepEqual(adjacency.get('A'), ['a', 'z', '中']);
  for (const id of ['a', 'z', '中']) assert.deepEqual(adjacency.get(id), ['A']);
  assert.deepEqual({ports, edges}, before);
});

test('static physical-anchor policy rejects malformed input at P5 without partial adjacency writes', () => {
  const port = {nodeId: 'node', side: 'EAST', x: 20, y: 10, anchor: {x: 0, y: 0}};
  for (const [edge, ports, adjacency, invariant] of [
    [{id: 'e'}, new Map(), new Map(), 'missing-physical-net'],
    [{id: 'e', physicalNetId: 'net', sourcePortId: 'p'}, new Map(), new Map(), 'missing-boundary-port'],
    [{id: 'e', physicalNetId: 'net', sourcePortId: 'p'},
      new Map([['p', {...port, x: Infinity}]]), new Map([['p', []]]), 'invalid-measured-anchor'],
  ]) {
    const before = structuredClone(adjacency);
    assert.throws(() => connectPhysicalAnchors([edge], ports, adjacency), error =>
      error.diagnostic?.phase === 'p5' && error.diagnostic.invariant === invariant);
    assert.deepEqual(adjacency, before);
  }
});
