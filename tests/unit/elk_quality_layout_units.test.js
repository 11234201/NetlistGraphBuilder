import assert from 'node:assert/strict';
import test from 'node:test';
import {cohereLayoutUnits,compileGroupSweep} from '../../tools/research/elk_phase_oracle/group_sweep.mjs';
import {loadPhaseOracles,inputFromSnapshot} from '../helpers/elk_phase_inputs.js';
import {createCanonicalGraph} from '../../src/layout/elk_native/ir.js';
import {orientGraph} from '../../src/layout/elk_native/p1_orientation.js';
import {assignLayers} from '../../src/layout/elk_native/p2_layering.js';
import {buildProperGraph} from '../../src/layout/elk_native/proper_graph.js';
import {countCrossings} from '../../src/layout/elk_native/crossing_counter.js';
test('layout units move singletons with weighted groups without reordering group members',()=>{
  const ids=['a','c','n','b','d'],membership=new Map([['a','one'],['b','one'],['c','two'],['d','two']]);
  const band={nodeIds:['a','c','b','d'],membership};
  const states=new Map([['a',{value:0,degree:1}],['b',{value:8,degree:9}],
    ['c',{value:4,degree:1}],['d',{value:5,degree:1}],['n',{value:3,degree:1}]]);
  const before=structuredClone({ids,states,band});
  assert.deepEqual(cohereLayoutUnits(ids,states,[band]),['n','c','d','a','b']);
  assert.deepEqual(cohereLayoutUnits(ids,states,[{...band,nodeIds:band.nodeIds.toReversed()}]),['n','c','d','a','b']);
  assert.deepEqual({ids,states,band},before);
  assert.throws(()=>cohereLayoutUnits(ids,states,[band,band]),/overlapping/);
  assert.throws(()=>cohereLayoutUnits(ids,new Map(),[band]),/invalid unit state/);
});
test('layout unit identities cannot collide with singleton ids or merge separate visual bands',()=>{
  const ids=['a','b','c','["group",0,"same"]'],states=new Map(ids.map(id=>[id,{value:1,degree:0}]));
  const membership=new Map([['a','same'],['b','same'],['c','same']]);
  const result=cohereLayoutUnits(ids,states,[{nodeIds:['a','b'],membership},{nodeIds:['c'],membership}]);
  assert.deepEqual(result,ids);assert.deepEqual(cohereLayoutUnits(ids,states,[]),ids);
});
test('unit sweep preserves immutable proper graph, complete orders and membership permutation',async()=>{
  const oracle=(await loadPhaseOracles()).find(oracle=>oracle.fixture.caseId==='diamond');
  const graph=buildProperGraph(assignLayers(orientGraph(createCanonicalGraph(inputFromSnapshot(oracle.snapshots[0])))));
  const entries=graph.nodes.filter(node=>node.kind!=='long_edge').map(node=>({nodeId:node.id,membershipKey:node.id}));
  const before=structuredClone(graph),sweep=await compileGroupSweep(entries,{layoutUnits:true}),result=sweep(graph);
  assert.equal(countCrossings(result),result.phaseData.crossings);assert.deepEqual(graph,before);
  assert.deepEqual((await compileGroupSweep(entries.toReversed(),{layoutUnits:true}))(graph),result);
  for(const node of result.nodes)assert.equal(result.layers[node.layer].nodeIds[node.order],node.id);
});
