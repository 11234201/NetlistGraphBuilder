import assert from 'node:assert/strict';
import test from 'node:test';
import {scoreOrderGroups} from '../../tools/research/elk_phase_oracle/order_group_score.mjs';
import {forecastOrderGroupBands} from '../../tools/research/elk_phase_oracle/order_group_bands.mjs';
const entries=[{nodeId:'a',membershipKey:'one'},{nodeId:'b',membershipKey:'one'},
  {nodeId:'c',membershipKey:'two'},{nodeId:'d',membershipKey:'two'}];
test('order-group proxy distinguishes interleaving, ignores ungrouped dummies and preserves inputs',()=>{
  const before=structuredClone(entries),interleaved=[{index:0,nodeIds:['a','c','dummy','b','d']}];
  const score=scoreOrderGroups(interleaved,entries);
  assert.equal(score.fragmentedGroupCount,2);assert.equal(score.extraIntervals,2);
  assert.equal(scoreOrderGroups([{index:0,nodeIds:['a','dummy','b','c','d']}],entries).fragmentedGroupCount,0);
  assert.deepEqual(scoreOrderGroups(interleaved,entries.toReversed()),score);
  assert.deepEqual(entries,before);
});
test('visual-band forecast reads only measured geometry/topology and is permutation independent',()=>{
  const node=(id,width)=>({id,width,height:20,x:999,y:999,margins:{left:0,right:0,top:0,bottom:0},
    ports:[{id:`${id}:in`,side:'WEST',x:0,y:10,width:0,height:0,anchor:{x:0,y:0}},
      {id:`${id}:out`,side:'EAST',x:width,y:10,width:0,height:0,anchor:{x:0,y:0}}]});
  const graph={nodes:[node('a',20),node('b',40)],edges:[{sourcePortId:'a:in',targetPortId:'b:in'}],
    layers:[{index:0,nodeIds:['a','b']}],selfLoops:[],options:{nodeNodeBetweenLayers:80}};
  const groups=[{nodeId:'a',membershipKey:'one'},{nodeId:'b',membershipKey:'two'}],before=structuredClone(graph);
  const result=forecastOrderGroupBands(graph,groups);
  assert.equal(result.bands.length,2);assert.deepEqual(graph,before);
  assert.deepEqual(forecastOrderGroupBands({...graph,nodes:graph.nodes.toReversed().map(node=>({...node,x:-5,y:-5,ports:node.ports.toReversed()})),
    edges:graph.edges.toReversed()},groups.toReversed()),result);
  assert.throws(()=>forecastOrderGroupBands({...graph,selfLoops:[{}]},groups),/self-loop margins/);
});
test('order-group proxy rejects ambiguous or missing memberships instead of dropping them',()=>{
  assert.throws(()=>scoreOrderGroups([{index:0,nodeIds:['a']}],entries),/missing group member/);
  assert.throws(()=>scoreOrderGroups([{index:0,nodeIds:['a','a','b','c','d']}],entries),/duplicate ordered node/);
  assert.throws(()=>scoreOrderGroups([{index:0,nodeIds:['a','b','c','d']}],[...entries,entries[0]]),/duplicate group member/);
});
