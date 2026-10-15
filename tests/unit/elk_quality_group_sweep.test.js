import assert from 'node:assert/strict';
import test from 'node:test';
import {cohereBandIds,compileGroupSweep} from '../../tools/research/elk_phase_oracle/group_sweep.mjs';
import {loadPhaseOracles,inputFromSnapshot} from '../helpers/elk_phase_inputs.js';
import {createCanonicalGraph} from '../../src/layout/elk_native/ir.js';
import {orientGraph} from '../../src/layout/elk_native/p1_orientation.js';
import {assignLayers} from '../../src/layout/elk_native/p2_layering.js';
import {buildProperGraph} from '../../src/layout/elk_native/proper_graph.js';
import {countCrossings} from '../../src/layout/elk_native/crossing_counter.js';
test('group sweep averages degree-weighted barycenters and preserves non-member slots/internal order',()=>{
  const ids=['a','c','n','b','d'],membership=new Map([['a','one'],['b','one'],['c','two'],['d','two']]);
  const bands=[{nodeIds:['a','c','b','d'],membership}],states=new Map([
    ['a',{value:0,degree:1}],['b',{value:8,degree:9}],['c',{value:4,degree:1}],['d',{value:5,degree:1}]]);
  assert.deepEqual(cohereBandIds(ids,states,bands),['c','d','n','a','b']);
  assert.deepEqual(ids,['a','c','n','b','d']);
  assert.throws(()=>cohereBandIds(ids,new Map(),bands),/missing group state/);
});
test('group sweep is deterministic, immutable and publishes consistent full node ordering/crossing evidence',async()=>{
  const oracle=(await loadPhaseOracles()).find(oracle=>oracle.fixture.caseId==='diamond');
  const input=inputFromSnapshot(oracle.snapshots[0]);
  const graph=buildProperGraph(assignLayers(orientGraph(createCanonicalGraph(input))));
  const entries=graph.nodes.filter(node=>node.kind!=='long_edge').map(node=>({nodeId:node.id,membershipKey:node.id}));
  const before=structuredClone(graph),sweep=await compileGroupSweep(entries),result=sweep(graph);
  assert.equal(countCrossings(result),result.phaseData.crossings);assert.deepEqual(graph,before);
  assert.deepEqual((await compileGroupSweep(entries.toReversed()))(graph),result);
  for(const node of result.nodes)assert.equal(result.layers[node.layer].nodeIds[node.order],node.id);
});
