import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizePolicy} from '../../../src/layout/elk_native/policy.js';
import {buildNeighborhood,alignBlocks} from '../../../src/layout/elk_native/bk_alignment.js';
import {compactBlocks} from '../../../src/layout/elk_native/bk_compaction.js';

// Isolate BK core on the upstream graph immediately before P4, not on our
// independently ranked/ordered graph. This research DTO cannot enter the public
// layout pipeline: upstream logical-chain representation is deliberately absent.
export function probeBkFromOracle(oracle,{clockwiseIncident=false,compactor=compactBlocks}={}){
  const p4Index=oracle.snapshots.findIndex((snapshot)=>snapshot.boundary==='p4');
  assert.ok(p4Index>0);
  const input=oracle.snapshots[p4Index-1],expected=oracle.snapshots[p4Index];
  assert.equal(input.components.length,1,'component-isolated probe requires one connected graph');
  const component=input.components[0];
  const nodes=component.nodes.map((node)=>({id:node.id,kind:node.kind,width:node.box.width,height:node.box.height,
    layer:node.layer,order:node.order,margins:node.margins,
    ports:node.ports.map((port)=>({id:port.id,nodeId:node.id,side:port.side,
      ...port.box,anchor:port.anchor,order:port.order}))}));
  const owners=new Map(nodes.flatMap((node)=>node.ports.map((port)=>[port.id,node.id])));
  const byId=new Map(nodes.map((node)=>[node.id,node]));
  const edges=component.edges.map((edge)=>{
    const sourceNodeId=owners.get(edge.sourcePortId),targetNodeId=owners.get(edge.targetPortId);
    const span=byId.get(targetNodeId).layer-byId.get(sourceNodeId).layer;
    assert.ok(span===0||span===1,`not proper at pre-P4 ${edge.id}: ${span}`);
    return {...edge,sourceNodeId,targetNodeId,segmentKind:span?'inter_layer':'inverted_port'};
  });
  const resolved=oracle.run.resolvedOptions;
  const options=normalizePolicy({nodeNodeSpacing:resolved['org.eclipse.elk.spacing.nodeNode'],
    edgeNodeSpacing:resolved['org.eclipse.elk.spacing.edgeNode'],edgeEdgeSpacing:resolved['org.eclipse.elk.spacing.edgeEdge'],
    favorStraightEdges:resolved['org.eclipse.elk.layered.nodePlacement.favorStraightEdges']});
  const graph={nodes,edges,layers:component.layers.map(({index,nodeIds})=>({index,nodeIds})),options};
  const context=buildNeighborhood(graph);
  if(clockwiseIncident)for(const [nodeId,incident] of context.incident){
    const ownedPort=(edge)=>context.ports.get(edge.sourceNodeId===nodeId?edge.sourcePortId:edge.targetPortId);
    incident.sort((left,right)=>ownedPort(left).order-ownedPort(right).order);
  }
  const indexedIds=graph.layers.flatMap((layer)=>layer.nodeIds);
  const reference=expected.phaseData.events.find((event)=>event.event==='bk-candidates');
  assert.ok(reference);
  const close=(actual,wanted)=>actual===wanted||(Number.isFinite(actual)&&Number.isFinite(wanted)&&Math.abs(actual-wanted)<1e-7);
  const decodeNumber=(value)=>value==='Infinity'?Infinity:value==='-Infinity'?-Infinity:value;
  const candidates=[];
  for(const horizontal of ['RIGHT','LEFT'])for(const vertical of ['DOWN','UP']){
    const result=compactor(context,alignBlocks(context,horizontal,vertical)),direction=`${horizontal}${vertical}`;
    const upstream=reference.candidates.find((candidate)=>candidate.direction===direction),fields={};
    for(const field of ['root','align','sink']){
      const diffs=indexedIds.flatMap((id,index)=>{
        const expectedId=indexedIds[Number.parseInt(upstream[field][index],10)];
        return result[field].get(id)===expectedId?[]:[{id,actual:result[field].get(id),expected:expectedId}];
      });
      fields[field]={count:diffs.length,examples:diffs.slice(0,8)};
    }
    for(const field of ['innerShift','blockSize','shift','y']){
      const diffs=indexedIds.flatMap((id,index)=>{
        const actual=(field==='y'?result.y.get(result.root.get(id)):result[field].get(id))??null;
        const wanted=decodeNumber(upstream[field][index]);
        return close(actual,wanted)?[]:[{id,actual,expected:wanted}];
      });
      fields[field]={count:diffs.length,examples:diffs.slice(0,8)};
    }
    candidates.push({direction,feasible:result.feasible,upstreamFeasible:upstream.feasible,
      size:result.size,upstreamSize:upstream.size,sizeMatches:close(result.size,upstream.size),fields});
  }
  return {caseId:oracle.fixture.caseId,clockwiseIncident,inputBoundary:input.boundary,inputProcessor:input.processor.className,
    nodes:nodes.length,edges:edges.length,upstreamSelected:reference.selected.direction,candidates,
    matches:candidates.every((candidate)=>candidate.feasible===candidate.upstreamFeasible&&candidate.sizeMatches&&
      Object.values(candidate.fields).every((field)=>field.count===0))};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,output]=process.argv.slice(2);
  if(!output)throw new Error('usage: probe_bk_from_oracle.mjs <oracle.json> <output.json>');
  const result=probeBkFromOracle(JSON.parse(await readFile(input,'utf8')),{clockwiseIncident:process.argv.includes('--clockwise-incident')});
  await writeFile(output,`${JSON.stringify(result,null,2)}\n`);
  console.log(JSON.stringify({...result,candidates:result.candidates.map(({fields,...candidate})=>
    ({...candidate,differences:Object.fromEntries(Object.entries(fields).map(([name,value])=>[name,value.count]))}))}));
}
