import assert from 'node:assert/strict';
import test from 'node:test';
import {splitImplicitEndpoints,layoutAliasControl} from '../../tools/research/elk_phase_oracle/probe_alias_key.mjs';
const input=()=>({nodes:[{id:'a',width:20,height:20,ports:[
  {id:'a::virtual:source',side:'EAST',x:20,y:10},{id:'a::virtual:target',side:'WEST',x:0,y:10}]},
  ...['b','c'].map(id=>({id,width:20,height:20,ports:[{id:`${id}:in`,side:'WEST',x:0,y:10}]}))],
  edges:['b','c'].map(id=>({id:`a${id}`,sourcePortId:'a::virtual:source',targetPortId:`${id}:in`,physicalNetId:'fan'}))});
test('alias research uses original trial identity formula and immutable declared pins',()=>{
  const graph=input(),before=structuredClone(graph),split=splitImplicitEndpoints(graph);
  assert.deepEqual(graph,before);assert.equal(split.nodes[0].ports.length,2);
  assert.deepEqual(split.nodes[0].ports.map(port=>port.id),['virtual:["a","source","ab"]','virtual:["a","source","ac"]']);
  assert.deepEqual(split.nodes[1].ports,graph.nodes[1].ports);
});
test('alias-key control keeps provenance true and freezes only research P3 key by component membership',async()=>{
  const graph=input(),before=structuredClone(graph),phases=[];
  const result=await layoutAliasControl(graph,{onPhase:phase=>phases.push(phase)},true);
  assert.deepEqual(graph,before);
  const p0=phases.find(phase=>phase.phase==='p0'),p3=phases.find(phase=>phase.phase==='p3');
  assert.equal(result.inputDigest,p0.inputDigest);
  assert.ok(!p3.phaseData.perturbationKey.startsWith(p0.inputDigest));
  assert.equal(result.phase,'complete');
});
