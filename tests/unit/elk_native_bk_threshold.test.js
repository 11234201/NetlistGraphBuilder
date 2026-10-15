import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanonicalGraph} from '../../src/layout/elk_native/ir.js';
import {buildNeighborhood} from '../../src/layout/elk_native/bk_alignment.js';
import {compactBlocks} from '../../src/layout/elk_native/bk_compaction.js';

// Four fixed single-node blocks isolate first-edge threshold consumption from
// median alignment. c's high WEST port is first clockwise, despite its later
// edge ID; its finished b block gives threshold 50+15-20=45 (spacing floor 30).
function fixture(reverse=false){
  const input={nodes:[
    {id:'a',width:40,height:30,ports:[{id:'a:out',side:'EAST',x:40,y:15}]},
    {id:'b',width:40,height:30,ports:[{id:'b:out',side:'EAST',x:40,y:15}]},
    {id:'d',width:40,height:10,ports:[]},
    {id:'c',width:40,height:30,ports:[{id:'c:low',side:'WEST',x:0,y:10},{id:'c:high',side:'WEST',x:0,y:20}]}
  ],edges:[
    {id:'a_low',physicalNetId:'low',sourcePortId:'a:out',targetPortId:'c:low'},
    {id:'z_high',physicalNetId:'high',sourcePortId:'b:out',targetPortId:'c:high'}
  ]};
  if(reverse){input.nodes.reverse();input.edges.reverse();for(const node of input.nodes)node.ports.reverse();}
  const canonical=createCanonicalGraph(input),layers=[{index:0,nodeIds:['a','b']},{index:1,nodeIds:['d','c']}];
  const rank=new Map(layers.flatMap((layer)=>layer.nodeIds.map((id,order)=>[id,{layer:layer.index,order}])));
  const graph={...canonical,nodes:canonical.nodes.map((node)=>({...node,...rank.get(node.id)})),layers,
    edges:canonical.edges.map((edge)=>({...edge,segmentKind:'inter_layer'}))};
  const context=buildNeighborhood(graph),ids=layers.flatMap((layer)=>layer.nodeIds);
  const identity=new Map(ids.map((id)=>[id,id]));
  const layout={root:identity,align:identity,innerShift:new Map(ids.map((id)=>[id,0])),
    blocks:new Map(ids.map((id)=>[id,[id]])),onlyDummies:new Map(ids.map((id)=>[id,false])),
    blockSize:new Map(graph.nodes.map((node)=>[node.id,node.height])),horizontal:'RIGHT',vertical:'DOWN'};
  return {graph,context,layout};
}

test('BK threshold uses clockwise owned-port order, not global logical edge order',()=>{
  const {graph,context,layout}=fixture(),before=structuredClone(graph);
  assert.deepEqual(context.incident.get('c').map((edge)=>edge.id),['z_high','a_low']);
  const result=compactBlocks(context,layout);
  assert.equal(result.nodeY.get('c'),45);assert.equal(result.feasible,true);
  assert.deepEqual(graph,before);
  const permuted=fixture(true);
  assert.deepEqual(compactBlocks(permuted.context,permuted.layout),result);
});
