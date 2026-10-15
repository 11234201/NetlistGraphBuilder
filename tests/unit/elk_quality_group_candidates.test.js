import assert from 'node:assert/strict';
import test from 'node:test';
import {buildOrderGroupCandidates,selectOrderGroupCandidate} from '../../tools/research/elk_phase_oracle/order_group_candidates.mjs';
import {createCanonicalGraph} from '../../src/layout/elk_native/ir.js';
import {orientGraph} from '../../src/layout/elk_native/p1_orientation.js';
import {assignLayers} from '../../src/layout/elk_native/p2_layering.js';
import {buildProperGraph} from '../../src/layout/elk_native/proper_graph.js';
import {countCrossings} from '../../src/layout/elk_native/crossing_counter.js';
import {freezeRecord} from '../../src/layout/elk_native/protocol.js';
const entries=['a','b','c','d'].map(nodeId=>({nodeId,membershipKey:nodeId<'c'?'one':'two'}));
test('fixed group candidates preserve non-member slots/ports, identity and group internal order',()=>{
  const graph={nodes:['a','b','c','d','n'].map(id=>({id,ports:[],layer:0})),layers:[{index:0,nodeIds:['a','c','n','b','d']}]};
  const before=structuredClone(graph),bands=[{rank:0,nodeIds:['a','c','b','d']}];
  const candidates=buildOrderGroupCandidates(graph,entries,bands);
  assert.equal(candidates.length,3);
  for(const candidate of candidates){assert.equal(candidate.graph.layers[0].nodeIds[2],'n');
    assert.deepEqual(candidate.graph.nodes.map(node=>node.ports),graph.nodes.map(node=>node.ports));}
  assert.deepEqual(candidates[1].graph.layers[0].nodeIds,['a','b','n','c','d']);
  assert.deepEqual(buildOrderGroupCandidates(graph,entries.toReversed(),bands),candidates);
  assert.deepEqual(graph,before);
  assert.throws(()=>buildOrderGroupCandidates(graph,entries,[...bands,bands[0]]),/overlapping bands/);
});
function graphWithConstraint(constrained){
  const input={nodes:[...['a','b','c','d'].map(id=>({id,width:20,height:20,ports:[{id:`${id}:o`,side:'EAST',x:20,y:10}]})),
    {id:'n',width:20,height:20,ports:[]},{id:'root',width:20,height:20,ports:[{id:'root:i',side:'WEST',x:0,y:10}]}],
    edges:['a','b','c','d'].map(id=>({id:`${id}:edge`,sourcePortId:`${id}:o`,targetPortId:'root:i',physicalNetId:'fan'}))};
  const proper=buildProperGraph(assignLayers(orientGraph(createCanonicalGraph(input))));
  const layers=[{index:0,nodeIds:['a','c','n','b','d']},{index:1,nodeIds:['root']}];
  const positions=new Map(layers.flatMap(layer=>layer.nodeIds.map((id,order)=>[id,order])));
  return freezeRecord({...proper,phase:'p3',layers,nodes:proper.nodes.map(node=>({...node,order:positions.get(node.id)})),
    orderConstraints:constrained?[{before:'c',after:'b'}]:[],phaseData:{crossings:countCrossings({...proper,layers})}});
}
test('group scoring reduces fragmentation when admissible, and never bypasses explicit constraints',()=>{
  const source=graphWithConstraint(false),before=structuredClone(source),selected=selectOrderGroupCandidate(source,entries);
  assert.equal(selected.phaseData.researchCohesion.scoreTuple[0],0);
  assert.ok(selected.phaseData.crossings<=source.phaseData.crossings);assert.deepEqual(source,before);
  const constrained=selectOrderGroupCandidate(graphWithConstraint(true),entries);
  assert.equal(constrained.phaseData.researchCohesion.policy,'original');
  assert.ok(constrained.phaseData.researchCohesion.candidates.slice(1).every(candidate=>!candidate.valid&&!candidate.admissible));
});
