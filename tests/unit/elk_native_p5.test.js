import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadPhaseOracles,graphFromP4Oracle } from '../helpers/elk_phase_inputs.js';
import { preparePortGeometry } from '../../src/layout/elk_native/port_geometry.js';
import { routeEdges } from '../../src/layout/elk_native/p5_routing.js';
import { restoreLogicalEdges } from '../../src/layout/elk_native/restore_edges.js';
import { validateRoutes } from '../../src/layout/elk_native/validate_routes.js';
import { createCanonicalGraph } from '../../src/layout/elk_native/ir.js';
import { orientGraph } from '../../src/layout/elk_native/p1_orientation.js';
import { assignLayers } from '../../src/layout/elk_native/p2_layering.js';
import { buildProperGraph } from '../../src/layout/elk_native/proper_graph.js';
import { orderLayers } from '../../src/layout/elk_native/p3_ordering.js';
import { mergeHyperedgeDummies } from '../../src/layout/elk_native/hyperedge_merge.js';
import { placeNodes } from '../../src/layout/elk_native/p4_placement.js';
import { inputFromSnapshot } from '../helpers/elk_phase_inputs.js';
import { prepareSelfLoops } from '../../src/layout/elk_native/self_loops.js';
const corpus=await loadPhaseOracles();
const loopCorpus=await Promise.all(['self_loop_opposing','self_loop_same_side','self_loop_nested'].map(async(id)=>
  JSON.parse(await readFile(new URL(`../fixtures/elk_parity/oracles/${id}.elk.json`,import.meta.url),'utf8'))));
const pipeline=(input,policy={},translate=true)=>restoreLogicalEdges(routeEdges(placeNodes(prepareSelfLoops(preparePortGeometry(
  mergeHyperedgeDummies(orderLayers(buildProperGraph(assignLayers(orientGraph(createCanonicalGraph(input,policy)))))))))),{translate});

test('elk_native P5 fixed preceding boundary matches ELK node x and routed bends',()=>{
  for(const oracle of corpus){
    const result=routeEdges(preparePortGeometry(graphFromP4Oracle(oracle)));
    const expected=oracle.snapshots.find((entry)=>entry.boundary==='p5').components;
    for(const node of expected.flatMap((component)=>component.nodes).filter((node)=>node.kind==='normal')){
      assert.equal(result.nodes.find((entry)=>entry.id===node.id).x,node.box.x,`${oracle.fixture.caseId}/${node.id}/x`);
    }
    const key=(node,raw=false)=>node.kind==='long_edge'
      ?JSON.stringify([node.lineage,node.layer,raw?node.box.height:node.height]):node.id;
    const nativeNodes=new Map(result.nodes.map((node)=>[key(node),node]));
    const portMapping=new Map();
    for(const node of expected.flatMap((component)=>component.nodes)){
      const native=nativeNodes.get(key(node,true));
      for(const port of node.ports)portMapping.set(port.id,node.kind==='normal'?port.id:
        native.ports.find((entry)=>entry.side===port.side).id);
    }
    for(const edge of expected.flatMap((component)=>component.edges)){
      const actual=result.edges.find((entry)=>entry.logicalEdgeId===edge.logicalEdgeId
        &&entry.sourcePortId===portMapping.get(edge.sourcePortId)&&entry.targetPortId===portMapping.get(edge.targetPortId));
      assert.ok(actual,`${oracle.fixture.caseId}/${edge.id}/identity`);
      assert.deepEqual(actual.bendPoints,edge.bendPoints,`${oracle.fixture.caseId}/${edge.id}/bends`);
      assert.deepEqual(actual.junctionPoints,edge.junctionPoints,`${oracle.fixture.caseId}/${edge.id}/junctions`);
    }
  }
});

test('elk_native complete P1-P5 restores every logical edge and satisfies shared hard geometry',()=>{
  for(const oracle of corpus){
    const input=inputFromSnapshot(oracle.snapshots[0]),policy={nodeNodeSpacing:oracle.run.resolvedOptions['org.eclipse.elk.spacing.nodeNode'],
      nodeNodeBetweenLayers:oracle.run.resolvedOptions['org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers']};
    const result=pipeline(input,policy);
    assert.equal(result.nodes.length,input.nodes.length);
    assert.equal(result.edges.length,input.edges.length);
    validateRoutes(result);
    for(const original of input.edges){
      const actual=result.edges.find((edge)=>edge.id===original.id);
      assert.equal(actual.sourcePortId,original.sourcePortId);
      assert.equal(actual.targetPortId,original.targetPortId);
    }
    assert.deepEqual(pipeline({...input,nodes:[...input.nodes].reverse(),edges:[...input.edges].reverse()},policy),result);
  }
});

test('elk_native final validator rejects corrupt routes without repair or tolerance weakening',()=>{
  const result=pipeline(inputFromSnapshot(corpus[2].snapshots[0]));
  const corrupt=structuredClone(result);corrupt.edges[0].points[0].y+=1;
  assert.throws(()=>validateRoutes(corrupt),/detached-route/);
  const diagonal=structuredClone(result);diagonal.edges[0].points.splice(1,0,{x:diagonal.edges[0].points[0].x+1,y:diagonal.edges[0].points[0].y+1});
  assert.throws(()=>validateRoutes(diagonal),/wrong-port-access|non-orthogonal-route/);
});

test('elk_native fixed W/E self-hyperloops reserve margins before BK and restore immutable routes',()=>{
  for(const sameSide of [false,true])for(const shared of [false,true]){
    const input={nodes:[{id:'a',width:60,height:60,ports:[
      {id:'ab',side:'EAST',x:60,y:15},{id:'loop',side:'EAST',x:60,y:30},
      {id:'target',side:sameSide?'EAST':'WEST',x:sameSide?60:0,y:45},
      {id:'nested',side:'WEST',x:0,y:20}]},{id:'b',width:40,height:30,ports:[{id:'bi',side:'WEST',x:0,y:15}]}],
    edges:[{id:'ab',physicalNetId:'n_ab',sourcePortId:'ab',targetPortId:'bi'},
      {id:'loop',physicalNetId:'n_loop',sourcePortId:'loop',targetPortId:'target'},
      ...(shared?[{id:'nested',physicalNetId:'n_loop',sourcePortId:'loop',targetPortId:'nested'}]:[])]};
    const result=pipeline(input);validateRoutes(result);
    assert.equal(result.edges.length,input.edges.length);
    assert.ok(result.nodes.find((node)=>node.id==='a').margins.right>=10);
    assert.deepEqual(pipeline({...input,nodes:[...input.nodes].reverse(),edges:[...input.edges].reverse()}),result);
    assert.deepEqual(input.nodes[0].ports[1],{id:'loop',side:'EAST',x:60,y:30});
  }
});

test('elk_native self-loop margins and final routing match three pinned source cases',()=>{
  for(const oracle of loopCorpus){
    const result=pipeline(inputFromSnapshot(oracle.snapshots[0]),{},false);
    const expected=oracle.snapshots.at(-1).components;
    for(const node of expected.flatMap((component)=>component.nodes)){
      const actual=result.nodes.find((entry)=>entry.id===node.id);
      assert.equal(actual.x,node.box.x,`${oracle.fixture.caseId}/${node.id}/x`);
      assert.equal(actual.y,node.box.y,`${oracle.fixture.caseId}/${node.id}/y`);
      assert.deepEqual(actual.margins,node.margins,`${oracle.fixture.caseId}/${node.id}/margins`);
    }
    for(const edge of expected.flatMap((component)=>component.edges)){
      const actual=result.edges.find((entry)=>entry.id===edge.logicalEdgeId);
      assert.deepEqual(actual.bendPoints,edge.bendPoints,`${oracle.fixture.caseId}/${edge.logicalEdgeId}/bends`);
    }
    validateRoutes(result);
  }
});

test('elk_native explicit long-edge join and direction restoration match ELK restored boundary',()=>{
  for(const oracle of corpus){
    const result=restoreLogicalEdges(routeEdges(preparePortGeometry(graphFromP4Oracle(oracle))),{translate:false});
    // The named restored boundary is after joining, before ReversedEdgeRestorer.
    const expected=oracle.snapshots.find((entry)=>entry.boundary==='final');
    for(const edge of expected.components.flatMap((component)=>component.edges)){
      const actual=result.edges.find((entry)=>entry.id===edge.logicalEdgeId);
      assert.equal(actual.sourcePortId,edge.sourcePortId);
      assert.equal(actual.targetPortId,edge.targetPortId);
      // The public contract removes collinear intermediate points, without changing geometry.
      assert.deepEqual(actual.bendPoints,edge.bendPoints,`${oracle.fixture.caseId}/${edge.logicalEdgeId}/restored-bends`);
      assert.deepEqual(actual.junctionPoints,edge.junctionPoints,`${oracle.fixture.caseId}/${edge.logicalEdgeId}/restored-junctions`);
    }
  }
});

test('elk_native P5 is immutable, permutation-stable and optionally unobserved',()=>{
  for(const oracle of corpus){
    const input=preparePortGeometry(graphFromP4Oracle(oracle)),before=structuredClone(input);
    const result=routeEdges(input);
    assert.deepEqual(input,before);
    assert.deepEqual(routeEdges({...input,nodes:[...input.nodes].reverse(),edges:[...input.edges].reverse()}),
      {...result,nodes:[...result.nodes].reverse(),edges:[...result.edges].reverse()});
    assert.deepEqual(routeEdges(input,{observe:false}).phaseData.events,[]);
  }
  assert.throws(()=>routeEdges(preparePortGeometry(graphFromP4Oracle(corpus[0])),{signal:AbortSignal.abort()}),/abort/i);
});
