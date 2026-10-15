import assert from 'node:assert/strict';
import {createCanonicalGraph} from '../../../src/layout/elk_native/ir.js';
import {orientGraph} from '../../../src/layout/elk_native/p1_orientation.js';
import {buildProperGraph} from '../../../src/layout/elk_native/proper_graph.js';
import {validateProperGraph} from '../../../src/layout/elk_native/validate_proper.js';
import {freezeRecord} from '../../../src/layout/elk_native/protocol.js';
import {inputFromSnapshot} from '../../../tests/helpers/elk_phase_inputs.js';

const nodesOf=(snapshot)=>snapshot.components.flatMap((component)=>component.nodes);
const edgesOf=(snapshot)=>snapshot.components.flatMap((component)=>component.edges);
const key=(node,raw=false)=>node.kind==='long_edge'?JSON.stringify([node.lineage,node.layer,raw?node.box.height:node.height]):node.id;

// Diagnostic input only: freeze the *observed* upstream ranks/ports/order rather
// than silently treating our independently chosen ranks as upstream evidence.
export function properInputFromOracle(oracle,{observedInitialization=true}={}){
  const p3Index=oracle.snapshots.findIndex((snapshot)=>snapshot.boundary==='p3');
  assert.ok(p3Index>0);assert.equal(oracle.snapshots[p3Index-1].components.length,1);
  const resolved=oracle.run.resolvedOptions;
  const canonical=createCanonicalGraph(inputFromSnapshot(oracle.snapshots[0]),{
    nodeNodeSpacing:resolved['org.eclipse.elk.spacing.nodeNode'],
    nodeNodeBetweenLayers:resolved['org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers'],
    edgeNodeSpacing:resolved['org.eclipse.elk.spacing.edgeNode'],
    edgeEdgeSpacing:resolved['org.eclipse.elk.spacing.edgeEdge'],
    edgeNodeBetweenLayers:resolved['org.eclipse.elk.layered.spacing.edgeNodeBetweenLayers']});
  const p1=orientGraph(canonical),upstreamP1=oracle.snapshots.find((snapshot)=>snapshot.boundary==='p1');
  const owners=new Map(nodesOf(upstreamP1).flatMap((node)=>node.ports.map((port)=>[port.id,node.id])));
  const directed=new Map(edgesOf(upstreamP1).map((edge)=>[edge.logicalEdgeId,edge]));
  for(const edge of p1.edges){
    const expected=directed.get(edge.id);assert.ok(expected);
    assert.equal(edge.reversed,expected.reversed);assert.equal(edge.sourceNodeId,owners.get(expected.sourcePortId));
    assert.equal(edge.targetNodeId,owners.get(expected.targetPortId));
    assert.equal(edge.sourcePortId,expected.sourcePortId);assert.equal(edge.targetPortId,expected.targetPortId);
  }
  const upstreamP2=oracle.snapshots.find((snapshot)=>snapshot.boundary==='p2');
  const ranks=new Map(nodesOf(upstreamP2).map((node)=>[node.id,node.layer]));
  const nodes=p1.nodes.map((node)=>({...node,layer:ranks.get(node.id)}));
  const layers=Array.from({length:upstreamP2.metrics.layerCount},(_,index)=>({index,nodeIds:nodes.filter((node)=>node.layer===index).map((node)=>node.id)}));
  const objective=p1.edges.reduce((sum,edge)=>sum+edge.weight*(ranks.get(edge.targetNodeId)-ranks.get(edge.sourceNodeId)),0);
  const proper=buildProperGraph({...p1,phase:'p2',nodes,layers,phaseData:{objectiveWeightedSpan:objective}});
  return observedInitialization?graphInOracleOrder(proper,oracle.snapshots[p3Index-1]):proper;
}

export function graphInOracleOrder(proper,snapshot){
  const rawNodes=nodesOf(snapshot),rawEdges=edgesOf(snapshot),byKey=new Map(proper.nodes.map((node)=>[key(node),node]));
  assert.equal(byKey.size,proper.nodes.length,'ambiguous native dummy key');
  assert.equal(rawNodes.length,proper.nodes.length,'proper node count differs');
  assert.equal(rawEdges.length,proper.edges.length,'proper edge count differs');
  const mapping=new Map(rawNodes.map((node)=>{
    const actual=byKey.get(key(node,true));assert.ok(actual,`missing semantic node ${node.id}`);return [node.id,actual.id];
  }));
  assert.equal(new Set(mapping.values()).size,proper.nodes.length,'non-bijective node mapping');
  const rawById=new Map(rawNodes.map((node)=>[mapping.get(node.id),node]));
  const ports=new Map();
  const nodes=proper.nodes.map((node)=>{
    const raw=rawById.get(node.id);
    for(const port of raw.ports){
      const actual=node.kind==='long_edge'?node.ports.find((entry)=>entry.side===port.side):node.ports.find((entry)=>entry.id===port.id);
      assert.ok(actual,`missing semantic port ${port.id}`);ports.set(port.id,actual.id);
    }
    assert.equal(raw.ports.length,node.ports.length,'proper port count differs');
    const rawPorts=new Map(raw.ports.map((port)=>[ports.get(port.id),port]));
    const converted=node.ports.map((port)=>({...port,...rawPorts.get(port.id).box,
      order:rawPorts.get(port.id).order,anchor:{...rawPorts.get(port.id).anchor}}));
    // Long-edge chain convention remains WEST/EAST; normal ports consume the
    // exact recorded clockwise order. No geometry is inferred from array IDs.
    if(node.kind!=='long_edge')converted.sort((a,b)=>a.order-b.order);
    return {...node,width:raw.box.width,height:raw.box.height,margins:{...raw.margins},order:raw.order,ports:converted};
  });
  const semanticEdge=(edge)=>JSON.stringify([edge.logicalEdgeId,edge.sourcePortId,edge.targetPortId]);
  const nativeEdges=new Map(proper.edges.map((edge)=>[semanticEdge(edge),edge]));
  assert.equal(nativeEdges.size,proper.edges.length);
  for(const edge of rawEdges){
    const actual=nativeEdges.get(semanticEdge({...edge,sourcePortId:ports.get(edge.sourcePortId),targetPortId:ports.get(edge.targetPortId)}));
    assert.ok(actual,`missing semantic segment ${edge.id}`);assert.equal(actual.physicalNetId,edge.physicalNetId);
  }
  const result={...proper,nodes,layers:snapshot.components[0].layers.map(({index,nodeIds})=>
    ({index,nodeIds:nodeIds.map((id)=>mapping.get(id))})),phaseData:{diagnosticBoundary:snapshot.boundary,
      diagnosticProcessor:snapshot.processor.className,rankingSource:'upstream-observed-ranks'}};
  validateProperGraph(result);return freezeRecord(result);
}
