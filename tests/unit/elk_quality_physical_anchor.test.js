import assert from 'node:assert/strict';
import test from 'node:test';
import {connectPhysicalAnchors,compilePhysicalAnchorRouting} from '../../tools/research/elk_phase_oracle/physical_anchor_routing.mjs';
import {createRoutingBoundaries} from '../../src/layout/elk_native/routing_segments.js';
import {routeEdges} from '../../src/layout/elk_native/p5_routing.js';
import {restoreLogicalEdges} from '../../src/layout/elk_native/restore_edges.js';
import {createCanonicalGraph} from '../../src/layout/elk_native/ir.js';
import {orientGraph} from '../../src/layout/elk_native/p1_orientation.js';
import {assignLayers} from '../../src/layout/elk_native/p2_layering.js';
import {buildProperGraph} from '../../src/layout/elk_native/proper_graph.js';
import {orderLayers} from '../../src/layout/elk_native/p3_ordering.js';
import {preparePortGeometry} from '../../src/layout/elk_native/port_geometry.js';
import {placeNodes} from '../../src/layout/elk_native/p4_placement.js';
import {validateRoutes} from '../../src/layout/elk_native/validate_routes.js';
const graphSpec=()=>({nodes:[{id:'s',width:40,height:40,ports:[{id:'s1',side:'EAST',x:40,y:20},{id:'s2',side:'EAST',x:40,y:20}]},
  ...['a','b'].map(id=>({id,width:40,height:40,ports:[{id:`${id}i`,side:'WEST',x:0,y:20}]}))],
  edges:['a','b'].map((id,index)=>({id:`s${id}`,physicalNetId:'fan',sourcePortId:`s${index+1}`,targetPortId:`${id}i`}))});
const toP4=input=>placeNodes(preparePortGeometry(orderLayers(buildProperGraph(assignLayers(orientGraph(createCanonicalGraph(input)))))));
test('physical anchor links require exactly the same net, node, side and point; identities remain independent',()=>{
  const base={nodeId:'n',side:'EAST',x:40,y:20,anchor:{x:0,y:0}};
  const ports=new Map([['p1',base],['p2',{...base}],['point',{...base,y:21}],['side',{...base,side:'WEST'}],
    ['node',{...base,nodeId:'other'}],['q',{...base,nodeId:'q'}]]);
  const edges=['p1','p2','point','side','node'].map(id=>({physicalNetId:'net',sourcePortId:id,targetPortId:'q'}));
  const adjacency=new Map([...ports.keys()].map(id=>[id,[]])),before=structuredClone({ports,edges});
  assert.deepEqual(connectPhysicalAnchors(edges,ports,adjacency),{groupCount:1,linkCount:1});
  assert.deepEqual(adjacency.get('p1'),['p2']);assert.deepEqual(adjacency.get('p2'),['p1']);
  for(const id of ['point','side','node'])assert.deepEqual(adjacency.get(id),[]);
  const different=new Map([...ports.keys()].map(id=>[id,[]]));
  connectPhysicalAnchors(edges.map((edge,index)=>({...edge,physicalNetId:String(index)})),ports,different);
  assert.deepEqual([...different.values()].flat(),[]);assert.deepEqual({ports,edges},before);
});
test('same preceding P4 anchor aliases share only P5 segments and restore every logical endpoint legally',async()=>{
  const p4=toP4(graphSpec()),before=structuredClone(p4),compiled=await compilePhysicalAnchorRouting();
  const base=createRoutingBoundaries(p4),alias=compiled.createRoutingBoundaries(p4);
  const count=result=>result.boundaries.reduce((sum,boundary)=>sum+boundary.segments.length,0);
  assert.equal(count(base),2);assert.equal(count(alias),1);
  const aliasedRoute=(await import(compiled.routeModule)).routeEdges;
  const original=routeEdges(p4),result=aliasedRoute(p4);
  assert.deepEqual(result.nodes.map(({x,...node})=>node),original.nodes.map(({x,...node})=>node));
  assert.deepEqual(result.edges.map(({points,bendPoints,junctionPoints,...edge})=>edge),
    original.edges.map(({points,bendPoints,junctionPoints,...edge})=>edge));
  const restored=restoreLogicalEdges(result);validateRoutes(restored);
  assert.equal(restored.edges.length,2);assert.deepEqual(p4,before);
  assert.ok(result.phaseData.events.some(event=>event.physicalAnchorAliases?.linkCount===1));
  const permuted={...p4,nodes:p4.nodes.toReversed(),edges:p4.edges.toReversed()};
  const aliasReversed=compiled.createRoutingBoundaries(permuted);
  // The scratch boundary retains the caller's edge array for lookup, not ordering.
  const byId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
  const orderedBoundaries=result=>result.boundaries.map(boundary=>({...boundary,edges:boundary.edges.toSorted(byId)}));
  assert.deepEqual(orderedBoundaries(aliasReversed),orderedBoundaries(alias));
  const permutedRoute=aliasedRoute(permuted);
  assert.deepEqual(permutedRoute.nodes.toSorted(byId),result.nodes.toSorted(byId));
  assert.deepEqual(permutedRoute.edges.toSorted(byId),result.edges.toSorted(byId));
  assert.deepEqual(permutedRoute.phaseData,result.phaseData);
  validateRoutes(restoreLogicalEdges(permutedRoute));
});
