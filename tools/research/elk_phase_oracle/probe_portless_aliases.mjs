import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCanonicalGraph} from '../../../src/layout/elk_native/ir.js';
import {buildProperGraph} from '../../../src/layout/elk_native/proper_graph.js';
import {orderLayers} from '../../../src/layout/elk_native/p3_ordering.js';
import {mergeHyperedgeDummies} from '../../../src/layout/elk_native/hyperedge_merge.js';
import {preparePortGeometry} from '../../../src/layout/elk_native/port_geometry.js';
import {placeNodes} from '../../../src/layout/elk_native/p4_placement.js';
import {createQualityBaseline} from './quality_baseline.mjs';

export function observedProperWithAliasMode(capture,witness,mode){
  assert.ok(['shared-role','per-edge-source'].includes(mode));
  const p0=witness.phases.find((phase)=>phase.phase==='p0'),p1=witness.phases.find((phase)=>phase.phase==='p1'),
    p2=witness.phases.find((phase)=>phase.phase==='p2');
  assert.ok(p0&&p1&&p2);
  assert.equal(capture.providerInputDigest,witness.providerInputDigest,'different product display inputs');
  const observedNodes=new Map(p0.normalNodes.map((node)=>[node.id,node]));
  const nodes=capture.graph.nodes.map((node)=>({...node,ports:structuredClone(observedNodes.get(node.id).ports)}));
  const byId=new Map(nodes.map((node)=>[node.id,node]));
  const portless=new Set(capture.graph.nodes.filter((node)=>node.ports.length===0).map((node)=>node.id));
  const clones=new Map();
  const edges=capture.graph.edges.map((edge)=>{
    let sourcePortId=edge.sourceEndpointKind==='node'?`${edge.source}::virtual:source`:edge.sourceEndpointId;
    const targetPortId=edge.targetEndpointKind==='node'?`${edge.target}::virtual:target`:edge.targetEndpointId;
    if(mode==='per-edge-source'&&edge.sourceEndpointKind==='node'){
      assert.ok(portless.has(edge.source));
      const node=byId.get(edge.source),original=node.ports.find((port)=>port.id===sourcePortId);assert.ok(original);
      sourcePortId=`${edge.source}::diagnostic-source:${JSON.stringify(edge.id)}`;
      const clone={...original,id:sourcePortId,declaredOrder:null};
      if(!clones.has(node.id))clones.set(node.id,[]);clones.get(node.id).push(clone);
    }
    return {id:edge.id,physicalNetId:edge.physicalNet,sourcePortId,targetPortId};
  });
  for(const [id,ports] of clones){
    const node=byId.get(id);node.ports=node.ports.filter((port)=>port.id!==`${id}::virtual:source`).concat(ports);
  }
  const canonical=createCanonicalGraph({nodes,edges},{nodeNodeSpacing:capture.options.nodeNodeSpacing,
    nodeNodeBetweenLayers:capture.options.nodeNodeBetweenLayers});
  const observedDirection=new Map(p1.orientedEdges.map((edge)=>[edge.id,edge]));
  const working=canonical.edges.map((edge)=>{
    const direction=observedDirection.get(edge.id);assert.ok(direction);
    const actual=direction.reversed?{...edge,reversed:true,sourcePortId:edge.targetPortId,targetPortId:edge.sourcePortId,
      sourceNodeId:edge.targetNodeId,targetNodeId:edge.sourceNodeId}:edge;
    assert.equal(actual.sourceNodeId,direction.sourceNodeId);assert.equal(actual.targetNodeId,direction.targetNodeId);
    return actual;
  });
  const ranks=new Map(p2.normalNodes.map((node)=>[node.id,node.layer]));
  const rankedNodes=canonical.nodes.map((node)=>({...node,layer:ranks.get(node.id)}));
  const layers=Array.from({length:Math.max(...ranks.values())+1},(_,index)=>({index,
    nodeIds:rankedNodes.filter((node)=>node.layer===index).map((node)=>node.id)}));
  const objective=working.reduce((sum,edge)=>sum+edge.weight*(ranks.get(edge.targetNodeId)-ranks.get(edge.sourceNodeId)),0);
  assert.equal(objective,p2.ranking.objectiveWeightedSpan);
  // A named diagnostic control, not a forged canonical hash: variants keep the
  // observed original P3 perturbation key to isolate port identity from RNG.
  const graph=buildProperGraph({...canonical,inputDigest:p0.graphInputDigest,phase:'p2',edges:working,nodes:rankedNodes,layers,
    phaseData:{objectiveWeightedSpan:objective}});
  return {graph,variantDigest:canonical.inputDigest,frozenPerturbationKey:p0.graphInputDigest,
    implicitSourcePortCount:graph.nodes.filter((node)=>portless.has(node.id))
      .reduce((sum,node)=>sum+node.ports.filter((port)=>port.side==='EAST').length,0)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [captureFile,witnessFile,output]=process.argv.slice(2);if(!output)throw new Error('usage: probe_portless_aliases.mjs <capture.json> <witness.json> <output-dir>');
  await mkdir(output,{recursive:true});
  const repoRoot=fileURLToPath(new URL('../../../',import.meta.url)),baseline=await createQualityBaseline(repoRoot,'q03_portless_aliases');
  await writeFile(path.join(output,'baseline.before.json'),JSON.stringify(baseline,null,2));
  const [capture,witness]=await Promise.all([captureFile,witnessFile].map((file)=>readFile(file,'utf8').then(JSON.parse)));
  const reports=[];
  for(const mode of ['shared-role','per-edge-source']){
    const {graph,variantDigest,frozenPerturbationKey,implicitSourcePortCount}=observedProperWithAliasMode(capture,witness,mode);
    const ordered=orderLayers(graph),merged=mergeHyperedgeDummies(ordered),placed=placeNodes(preparePortGeometry(merged));
    const chain=placed.chains.find((chain)=>chain.logicalEdgeId===witness.edgeId),nodeById=new Map(placed.nodes.map((node)=>[node.id,node]));assert.ok(chain);
    const tracked=chain.dummyNodeIds.map((id)=>nodeById.get(id)),candidates=placed.phaseData.candidates.map((candidate)=>{
      const roots=new Map(candidate.root),y=new Map(candidate.nodeY);
      return {direction:candidate.direction,size:candidate.size,feasible:candidate.feasible,
        dummyRoots:new Set(tracked.map((node)=>roots.get(node.id))).size,distinctDummyY:new Set(tracked.map((node)=>y.get(node.id))).size};
    });
    const originalP3=witness.phases.find((phase)=>phase.phase==='p3'),oldOrders=new Map(originalP3.nodes.map((node)=>[node.id,node.order]));
    const trackedBefore=graph.chains.find((chain)=>chain.logicalEdgeId===witness.edgeId).dummyNodeIds;
    const orderedNodes=new Map(ordered.nodes.map((node)=>[node.id,node]));
    const report={mode,variantDigest,frozenPerturbationKey,implicitSourcePortCount,crossings:ordered.phaseData.crossings,
      mergedDummies:merged.phaseData.mergedDummyCount,selected:placed.phaseData.selected,dummyCount:tracked.length,
      distinctDummyY:new Set(tracked.map((node)=>node.y)).size,
      originalTrackedOrderDifferences:trackedBefore.filter((id)=>orderedNodes.get(id).order!==oldOrders.get(id)).length,candidates};
    reports.push(report);console.log(JSON.stringify(report));
  }
  await writeFile(path.join(output,'report.json'),JSON.stringify({caseId:capture.caseId,edgeId:witness.edgeId,
    providerInputDigest:capture.providerInputDigest,scope:'diagnostic P1/ranks/perturbation key fixed; port identity only; no P5 or product claim',reports},null,2));
  const after=await createQualityBaseline(repoRoot,'q03_portless_aliases_after');
  await writeFile(path.join(output,'baseline.after.json'),JSON.stringify(after,null,2));assert.equal(after.fileSetDigest,baseline.fileSetDigest);
}
