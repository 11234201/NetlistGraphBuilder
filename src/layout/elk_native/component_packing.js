import { compareIds,freezeRecord } from './protocol.js';

// ELK SimpleRowGraphPlacer's area ordering and sqrt(area)*aspect row policy.
// Only entire disconnected completed graphs move; no connected tree/BK block packing.
export function packComponents(components,options){
  const ordered=[...components].sort((a,b)=>a.width*a.height-b.width*b.height||compareIds(a.nodes[0]?.id??'',b.nodes[0]?.id??''));
  const maximumWidth=ordered.reduce((value,graph)=>Math.max(value,graph.width),0);
  const area=ordered.reduce((value,graph)=>value+graph.width*graph.height,0);
  const rowWidth=Math.max(maximumWidth,Math.sqrt(area)*options.aspectRatio);
  const nodes=[],edges=[],placements=[];
  let x=0,y=0,rowHeight=0,width=0;
  for(const graph of ordered){
    if(x+graph.width>rowWidth){x=0;y+=rowHeight+options.componentSpacing;rowHeight=0;}
    const move=(point)=>({x:point.x+x,y:point.y+y});
    nodes.push(...graph.nodes.map((node)=>({...node,x:node.x+x,y:node.y+y})));
    edges.push(...graph.edges.map((edge)=>({...edge,points:edge.points.map(move),bendPoints:edge.bendPoints.map(move),junctionPoints:edge.junctionPoints.map(move)})));
    placements.push({nodeIds:graph.nodes.map((node)=>node.id),x,y,width:graph.width,height:graph.height});
    width=Math.max(width,x+graph.width);rowHeight=Math.max(rowHeight,graph.height);x+=graph.width+options.componentSpacing;
  }
  nodes.sort((a,b)=>compareIds(a.id,b.id));edges.sort((a,b)=>compareIds(a.id,b.id));
  return freezeRecord({nodes,edges,width,height:y+rowHeight,placements});
}
