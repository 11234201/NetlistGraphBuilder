import { createCanonicalGraph } from './ir.js';
import { orientGraph } from './p1_orientation.js';
import { assignLayers } from './p2_layering.js';
import { buildProperGraph } from './proper_graph.js';
import { orderLayers } from './p3_ordering.js';
import { mergeHyperedgeDummies } from './hyperedge_merge.js';
import { preparePortGeometry } from './port_geometry.js';
import { prepareSelfLoops } from './self_loops.js';
import { placeNodes } from './p4_placement.js';
import { routeEdges } from './p5_routing.js';
import { restoreLogicalEdges } from './restore_edges.js';
import { validateRoutes } from './validate_routes.js';
import { connectedComponents } from './components.js';
import { packComponents } from './component_packing.js';
import { checkCancelled,freezeRecord } from './protocol.js';
import {PhaseError} from './protocol.js';
import {normalizeH08Profile,withStructuralOrdering,orderH08Layers} from './h08_profile.js';
import {splitImplicitEndpoints} from './implicit_endpoints.js';
export { CONTRACT_VERSION,PACKAGE_VERSION,PhaseError } from './protocol.js';

// Offline ES-module entry. Only completed, validated geometry is returned;
// immutable raw phases are opt-in research observations, not partial UI results.
export async function layoutGraph(input,{policy={},signal,onPhase,yieldControl,profile='baseline',orderGroups=[]}={}){
  if(!['baseline','h08'].includes(profile))throw new PhaseError('p0','unsupported-profile');
  checkCancelled(signal);
  const h08=profile==='h08'?normalizeH08Profile(input,orderGroups):null;
  const canonicalInput=createCanonicalGraph(h08?splitImplicitEndpoints(input):input,policy,{signal});
  const canonical=h08?withStructuralOrdering(canonicalInput):canonicalInput;
  const observe=typeof onPhase==='function';
  const checkpoint=async(graph,componentId)=>{
    checkCancelled(signal);
    if(observe)await onPhase(graph,componentId);
    if(yieldControl)await yieldControl();
    checkCancelled(signal);
    return graph;
  };
  const members=connectedComponents(canonical.nodes,canonical.edges),results=[],metrics=[];
  const owners=new Map(members.flatMap((ids,index)=>ids.map((id)=>[id,index])));
  const nodeGroups=members.map(()=>[]),edgeGroups=members.map(()=>[]),loopGroups=members.map(()=>[]);
  // Components must be derived from the frozen P0 snapshot. An asynchronous
  // observer may change the caller's DTO while earlier components are running.
  for(const node of canonical.nodes)nodeGroups[owners.get(node.id)].push({...node,
    ports:node.ports.map((port)=>({...port,order:port.declaredOrder??undefined}))});
  const nodeByPort=new Map(canonical.nodes.flatMap((node)=>node.ports.map((port)=>[port.id,node.id])));
  for(const edge of [...canonical.edges,...canonical.selfLoops]){const index=owners.get(nodeByPort.get(edge.sourcePortId));
    (nodeByPort.get(edge.sourcePortId)===nodeByPort.get(edge.targetPortId)?loopGroups:edgeGroups)[index].push(edge);}
  for(let index=0;index<members.length;index++){
    const componentId=members[index][0],phaseOptions={signal,observe};
    let graph=members.length===1?canonical:createCanonicalGraph({nodes:nodeGroups[index],edges:[...edgeGroups[index],...loopGroups[index]]},canonical.options,{signal});
    if(h08&&members.length!==1)graph=withStructuralOrdering(graph);
    await checkpoint(graph,componentId);let crossings=null,ranking=null;
    for(const phase of [orientGraph,assignLayers,buildProperGraph,orderLayers,mergeHyperedgeDummies,preparePortGeometry,prepareSelfLoops]){
      graph=await checkpoint(h08&&phase===orderLayers?orderH08Layers(graph,phaseOptions,h08):phase(graph,phaseOptions),componentId);
      if(graph.phase==='p3')crossings=graph.phaseData.crossings;
      if(graph.phase==='p2')ranking={optimal:graph.phaseData.optimal,
        components:graph.phaseData.components.map(({iterationLimit,termination,pivotCount,zeroShiftCount,negativeCutCount})=>
          ({iterationLimit,termination,pivotCount,zeroShiftCount,negativeCutCount}))};
    }
    graph=await checkpoint(placeNodes(graph,phaseOptions),componentId);
    graph=await checkpoint(routeEdges(graph,{...phaseOptions,physicalAnchors:!!h08}),componentId);
    graph=restoreLogicalEdges(graph,{signal});validateRoutes(graph,{signal});
    results.push(graph);metrics.push({componentId,nodeCount:graph.nodes.length,edgeCount:graph.edges.length,
      layerCount:graph.layers.length,crossings:crossings??null,ranking});
  }
  const packed=packComponents(results,canonical.options);
  const result=freezeRecord({contractVersion:canonical.contractVersion,inputDigest:canonical.inputDigest,options:canonical.options,
    phase:'complete',nodes:packed.nodes,edges:packed.edges,width:packed.width,height:packed.height,
    physicalNets:canonical.physicalNets,phaseData:{components:metrics,placements:packed.placements,...(h08?{profile:h08}:{})}});
  validateRoutes(result,{signal});checkCancelled(signal);
  return result;
}
