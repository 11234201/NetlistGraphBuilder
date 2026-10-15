import test from 'node:test';
import assert from 'node:assert/strict';
import {observedProperWithAliasMode} from '../../tools/research/elk_phase_oracle/probe_portless_aliases.mjs';

test('portless identity ablation keeps coordinates/ranks/lineage/perturbation fixed and preserves source objects',()=>{
  const port=(id,side,x,y)=>({id,nodeId:id.split(':')[0],side,x,y,width:0,height:0,anchor:{x:0,y:0}});
  const capture={providerInputDigest:'display-input',options:{nodeNodeSpacing:48,nodeNodeBetweenLayers:80},graph:{
    nodes:[{id:'root',width:40,height:30,ports:[]},{id:'b',width:40,height:30,ports:[{}]},{id:'c',width:40,height:30,ports:[{}]}],
    edges:['b','c'].map((target)=>({id:`root-${target}`,source:'root',target,physicalNet:'n',sourceEndpointKind:'node',
      sourceEndpointId:'root',targetEndpointKind:'port',targetEndpointId:`${target}:in`}))}};
  const witness={providerInputDigest:'display-input',phases:[{phase:'p0',graphInputDigest:'00000000abcdef01',normalNodes:[
    {id:'root',ports:[port('root::virtual:source','EAST',40,15),port('root::virtual:target','WEST',0,15)]},
    {id:'b',ports:[port('b:in','WEST',0,15)]},{id:'c',ports:[port('c:in','WEST',0,15)]}
  ]},{phase:'p1',orientedEdges:['b','c'].map((target)=>({id:`root-${target}`,sourceNodeId:'root',targetNodeId:target,reversed:false}))},
  {phase:'p2',normalNodes:[{id:'root',layer:0},{id:'b',layer:1},{id:'c',layer:1}],ranking:{objectiveWeightedSpan:2}}]};
  const before=structuredClone({capture,witness});
  const shared=observedProperWithAliasMode(capture,witness,'shared-role'),split=observedProperWithAliasMode(capture,witness,'per-edge-source');
  assert.equal(shared.implicitSourcePortCount,1);assert.equal(split.implicitSourcePortCount,2);
  assert.equal(shared.frozenPerturbationKey,split.frozenPerturbationKey);
  assert.notEqual(shared.variantDigest,split.variantDigest);
  const splitRoot=split.graph.nodes.find((node)=>node.id==='root');
  assert.ok(splitRoot.ports.filter((port)=>port.side==='EAST').every((port)=>port.x===40&&port.y===15&&port.width===0));
  assert.deepEqual(split.graph.logicalEdges.map((edge)=>[edge.id,edge.physicalNetId,edge.sourceNodeId,edge.targetNodeId]),
    shared.graph.logicalEdges.map((edge)=>[edge.id,edge.physicalNetId,edge.sourceNodeId,edge.targetNodeId]));
  const reversed=structuredClone(capture);reversed.graph.nodes.reverse();reversed.graph.edges.reverse();
  assert.deepEqual(observedProperWithAliasMode(reversed,witness,'per-edge-source'),split);
  assert.deepEqual({capture,witness},before);assert.equal(Object.isFrozen(witness.phases[0].normalNodes[0].ports[0].anchor),false);
});
