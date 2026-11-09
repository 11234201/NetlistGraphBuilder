import { checkCancelled,freezeRecord,PhaseError } from './protocol.js';
import { compactOrthogonalPoints } from '../orthogonalRouting.js';

// LongEdgeJoiner behavior expressed through explicit immutable logical chains,
// rather than the upstream positional correspondence of mutable incidence lists.
export function restoreLogicalEdges(input,{signal,translate=true}={}){
  if(input.phase!=='p5')throw new PhaseError('restore','wrong-phase');
  const segments=new Map(input.edges.map((edge)=>[edge.id,edge]));
  const logical=new Map(input.logicalEdges.map((edge)=>[edge.id,edge]));
  const ports=new Map(input.nodes.flatMap((node)=>node.ports.map((port)=>[port.id,{node,port}])));
  const absolute=(id)=>{const {node,port}=ports.get(id);return {x:node.x+port.x+port.anchor.x,y:node.y+port.y+port.anchor.y};};
  let edges=input.chains.map((chain)=>{
    checkCancelled(signal);
    const edge=logical.get(chain.logicalEdgeId),parts=chain.segmentIds.map((id)=>segments.get(id));
    if(parts.some((part)=>!part))throw new PhaseError('restore','missing-chain-segment',[edge.id]);
    let points=compactOrthogonalPoints([absolute(edge.sourcePortId),...parts.flatMap((part)=>part.bendPoints),absolute(edge.targetPortId)]);
    if(edge.reversed)points=points.reverse();
    const junctions=new Map(parts.flatMap((part)=>part.junctionPoints).map((point)=>[JSON.stringify(point),point]));
    const sourcePortId=edge.originalSourcePortId,targetPortId=edge.originalTargetPortId;
    return {...edge,sourcePortId,targetPortId,sourceNodeId:ports.get(sourcePortId).node.id,
      targetNodeId:ports.get(targetPortId).node.id,points,bendPoints:points.slice(1,-1),junctionPoints:[...junctions.values()]};
  });
  let nodes=input.nodes.filter((node)=>node.kind!=='long_edge');
  const selfRoutes=new Map((input.selfLoopRoutes??[]).map((route)=>[route.edgeId,route]));
  for(const edge of input.selfLoops){
    const route=selfRoutes.get(edge.id);
    if(!route)throw new PhaseError('restore','self-loops-require-routing',[edge.id]);
    const node=ports.get(edge.sourcePortId).node;
    const bendPoints=route.bendPoints.map((point)=>({x:point.x+node.x,y:point.y+node.y}));
    const points=compactOrthogonalPoints([absolute(edge.sourcePortId),...bendPoints,absolute(edge.targetPortId)]);
    edges.push({...edge,points,bendPoints:points.slice(1,-1),junctionPoints:[]});
  }
  edges.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  let minimumX=0,minimumY=nodes.length?Infinity:0,maximumX=input.width,maximumY=nodes.length?-Infinity:0;
  for(const node of nodes){minimumX=Math.min(minimumX,node.x-node.margins.left);minimumY=Math.min(minimumY,node.y-node.margins.top);
    maximumX=Math.max(maximumX,node.x+node.width+node.margins.right);maximumY=Math.max(maximumY,node.y+node.height+node.margins.bottom);}
  for(const edge of edges)for(const point of edge.points){minimumX=Math.min(minimumX,point.x);minimumY=Math.min(minimumY,point.y);
    maximumX=Math.max(maximumX,point.x);maximumY=Math.max(maximumY,point.y);}
  const offset={x:translate?-minimumX:0,y:translate?-minimumY:0};
  const move=(point)=>({x:point.x+offset.x,y:point.y+offset.y});
  nodes=nodes.map((node)=>({...node,x:node.x+offset.x,y:node.y+offset.y}));
  edges=edges.map((edge)=>({...edge,points:edge.points.map(move),bendPoints:edge.bendPoints.map(move),junctionPoints:edge.junctionPoints.map(move)}));
  const {chains,logicalEdges,mergeEquivalences,...base}=input;
  const retainedIds=new Set(nodes.map((node)=>node.id));
  return freezeRecord({...base,phase:'restored',nodes,edges,
    layers:input.layers.map((layer)=>({...layer,nodeIds:layer.nodeIds.filter((id)=>retainedIds.has(id))})),
    width:maximumX-minimumX,height:maximumY-minimumY,phaseData:{offset,restoredEdgeCount:edges.length}});
}
