import { compareIds, PhaseError } from './protocol.js';
import { ORTHOGONAL_ROUTING_PROFILE as profile } from './policy.js';
import {connectPhysicalAnchors} from './physical_anchor_adjacency.js';

export function createRoutingBoundaries(graph,{physicalAnchors=false}={}) {
  const nodes=new Map(graph.nodes.map((node)=>[node.id,node]));
  const ports=new Map(graph.nodes.flatMap((node)=>node.ports.map((port)=>[port.id,port])));
  const boundaries=Array.from({length:graph.layers.length+1},(_,index)=>({sourceLayerIndex:index-1,edges:[]}));
  for(const edge of graph.edges) {
    const source=ports.get(edge.sourcePortId),target=ports.get(edge.targetPortId);
    const sourceLayer=nodes.get(source.nodeId).layer,targetLayer=nodes.get(target.nodeId).layer;
    const boundary=source.side==='EAST'?sourceLayer:sourceLayer-1;
    if(boundary!==(target.side==='WEST'?targetLayer-1:targetLayer))throw new PhaseError('p5','edge-crosses-wrong-boundary',[edge.id]);
    boundaries[boundary+1].edges.push(edge);
  }
  for(const boundary of boundaries) {
    const adjacency=new Map(),outgoing=new Map();
    for(const edge of boundary.edges) {
      for(const [a,b] of [[edge.sourcePortId,edge.targetPortId],[edge.targetPortId,edge.sourcePortId]]) {
        if(!adjacency.has(a))adjacency.set(a,[]);
        adjacency.get(a).push(b);
      }
      if(!outgoing.has(edge.sourcePortId))outgoing.set(edge.sourcePortId,[]);
      outgoing.get(edge.sourcePortId).push(edge);
    }
    if(physicalAnchors)boundary.physicalAnchorAliases=connectPhysicalAnchors(boundary.edges,ports,adjacency);
    const assigned=new Set(),segments=[];
    for(const initial of [...adjacency.keys()].sort(compareIds)) {
      if(assigned.has(initial))continue;
      const queue=[initial],memberPorts=[],edgeIds=[];assigned.add(initial);
      for(let i=0;i<queue.length;i++) {
        const portId=queue[i];memberPorts.push(portId);
        for(const edge of outgoing.get(portId)??[])edgeIds.push(edge.id);
        for(const other of adjacency.get(portId))if(!assigned.has(other)){assigned.add(other);queue.push(other);}
      }
      memberPorts.sort(compareIds);edgeIds.sort(compareIds);
      const incoming=[],outgoingCoordinates=[];
      for(const id of memberPorts) {
        const port=ports.get(id),coordinate=nodes.get(port.nodeId).y+port.y+port.anchor.y;
        (port.side==='EAST'?incoming:outgoingCoordinates).push(coordinate);
      }
      const unique=(values)=>[...new Set(values)].sort((a,b)=>a-b);
      const inCoordinates=unique(incoming),outCoordinates=unique(outgoingCoordinates);
      segments.push({id:`boundary:${JSON.stringify([boundary.sourceLayerIndex,edgeIds])}`,ports:memberPorts,edgeIds,
        incoming:inCoordinates,outgoing:outCoordinates,start:Math.min(...inCoordinates,...outCoordinates),
        end:Math.max(...inCoordinates,...outCoordinates),routingSlot:0,splitPartner:null,splitBy:null});
    }
    boundary.segments=segments.sort((a,b)=>compareIds(a.id,b.id));
    let minimum=Number.MAX_VALUE;
    for(const side of ['incoming','outgoing']) {
      const coordinates=[...new Set(segments.flatMap((segment)=>segment[side]))].sort((a,b)=>a-b);
      for(let i=1;i<coordinates.length;i++)minimum=Math.min(minimum,coordinates[i]-coordinates[i-1]);
    }
    boundary.criticalThreshold=profile.criticalThresholdFactor*minimum;
  }
  return {boundaries,nodes,ports};
}
