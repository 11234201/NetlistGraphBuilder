import { checkCancelled, freezeRecord } from './protocol.js';
import { validateP4 } from './validate_p4.js';
import { ORTHOGONAL_ROUTING_PROFILE as profile } from './policy.js';
import { createRoutingBoundaries } from './routing_segments.js';
import { buildDependencies } from './routing_dependencies.js';
import { splitCriticalCycles } from './routing_split.js';
import { removeRegularCycles } from './routing_cycles.js';
import { assignRoutingSlots } from './routing_slots.js';
import { measureLayerAlignment } from './layer_alignment.js';

export function routeEdges(input,{signal,observe=true,physicalAnchors=false}={}) {
  validateP4(input);
  const {boundaries,nodes,ports}=createRoutingBoundaries(input,{physicalAnchors}),options=input.options;
  const positions=new Map(),routes=new Map(),events=[];
  const edgesById=new Map(input.edges.map((edge)=>[edge.id,edge]));
  const {layerWidths,offsets}=measureLayerAlignment(input);
  const placeLayer=(index,offset)=> {
    const layer=input.layers[index];
    for(const id of layer.nodeIds) {
      positions.set(id,offset+offsets.get(id));
    }
  };
  let x=0;
  for(const boundary of boundaries) {
    checkCancelled(signal);
    const left=boundary.sourceLayerIndex,right=left+1;
    if(left>=0){placeLayer(left,x);x+=layerWidths[left];}
    const before=x,start=x+(left>=0?options.edgeNodeBetweenLayers:0);
    const capture=(stage,segments,dependencies,extra={})=>{
      if(physicalAnchors)extra={physicalAnchorAliases:boundary.physicalAnchorAliases,...extra};
      if(observe)events.push({stage,sourceLayerIndex:left,criticalThreshold:boundary.criticalThreshold,
        startPosition:start,edgeSpacing:options.edgeEdgeSpacing,segments:segments.map((segment)=>({...segment,
          incoming:[...segment.incoming],outgoing:[...segment.outgoing]})),dependencies:dependencies.map((edge)=>({...edge})),...extra});
    };
    const dependencyResult=buildDependencies(boundary.segments,boundary.criticalThreshold,options.edgeEdgeSpacing,{signal});
    capture('dependencies',boundary.segments,dependencyResult.dependencies);
    const split=splitCriticalCycles(boundary.segments,dependencyResult.dependencies,boundary.criticalThreshold,options.edgeEdgeSpacing,{signal});
    capture('after-critical',split.segments,split.dependencies,{splits:split.splits,decisions:split.decisions});
    const acyclic=removeRegularCycles(split.segments,split.dependencies,{signal});
    capture('acyclic',split.segments,acyclic.dependencies,{decisions:acyclic.decisions});
    const slotResult=assignRoutingSlots(split.segments,acyclic.dependencies,{signal});
    for(const segment of split.segments)segment.routingSlot=slotResult.slots.get(segment.id);
    capture('slotted',split.segments,acyclic.dependencies);
    const segmentById=new Map(split.segments.map((segment)=>[segment.id,segment]));
    const junctions=new Set();let slotCount=0;
    const addJunction=(route,segment,point)=> {
      const coordinate=point.y,key=JSON.stringify(point);
      if(junctions.has(key))return;
      const sameBoundary=segment.incoming.length&&segment.outgoing.length
        &&(Math.abs(coordinate-segment.incoming[0])<profile.tolerance&&Math.abs(coordinate-segment.outgoing[0])<profile.tolerance
        ||Math.abs(coordinate-segment.incoming.at(-1))<profile.tolerance&&Math.abs(coordinate-segment.outgoing.at(-1))<profile.tolerance);
      if(coordinate>segment.start&&coordinate<segment.end||sameBoundary){route.junctionPoints.push({...point});junctions.add(key);}
    };
    for(const segment of split.segments) {
      if(Math.abs(segment.start-segment.end)<profile.tolerance)continue;
      slotCount=Math.max(slotCount,segment.routingSlot+1);
      if(segment.splitPartner&&!segment.splitBy)continue;
      for(const id of segment.edgeIds) {
        const edge=edgesById.get(id),source=ports.get(edge.sourcePortId),target=ports.get(edge.targetPortId);
        const sourceY=nodes.get(source.nodeId).y+source.y+source.anchor.y,targetY=nodes.get(target.nodeId).y+target.y+target.anchor.y;
        const route={bendPoints:[],junctionPoints:[]};routes.set(id,route);
        if(Math.abs(sourceY-targetY)<=profile.tolerance)continue;
        let current=segment,currentX=start+current.routingSlot*options.edgeEdgeSpacing;
        const add=(y)=> {const point={x:currentX,y};route.bendPoints.push(point);addJunction(route,current,point);};
        add(sourceY);
        if(segment.splitPartner) {
          const partner=segmentById.get(segment.splitPartner),splitY=partner.incoming[0];
          add(splitY);current=partner;currentX=start+partner.routingSlot*options.edgeEdgeSpacing;add(splitY);
        }
        add(targetY);
      }
    }
    capture('routed',split.segments,acyclic.dependencies,{slotCount});
    const leftExternal=left<0,rightExternal=right>=input.layers.length;
    let width=slotCount?Math.max((slotCount-1)*options.edgeEdgeSpacing+(leftExternal?0:options.edgeNodeBetweenLayers)
      +(rightExternal?0:options.edgeNodeBetweenLayers),!leftExternal&&!rightExternal?options.nodeNodeBetweenLayers:0)
      :!leftExternal&&!rightExternal?options.nodeNodeBetweenLayers:0;
    x+=width;
    if(observe)events.push({stage:'boundary-width',sourceLayerIndex:left,slotCount,xBefore:before,xAfter:x,width});
  }
  const positionedNodes=input.nodes.map((node)=>({...node,x:positions.get(node.id)}));
  const absolute=(portId)=>{const port=ports.get(portId);return {x:positions.get(port.nodeId)+port.x+port.anchor.x,
    y:nodes.get(port.nodeId).y+port.y+port.anchor.y};};
  const edges=input.edges.map((edge)=>({...edge,...(routes.get(edge.id)??{bendPoints:[],junctionPoints:[]}),
    points:[absolute(edge.sourcePortId),...(routes.get(edge.id)?.bendPoints??[]),absolute(edge.targetPortId)]}));
  return freezeRecord({...input,phase:'p5',nodes:positionedNodes,edges,width:x,phaseData:{events}});
}
