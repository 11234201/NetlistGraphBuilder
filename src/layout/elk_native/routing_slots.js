import { compareIds, PhaseError, checkCancelled } from './protocol.js';

export function assignRoutingSlots(segments,dependencies,{signal}={}) {
  const incoming=new Map(segments.map((segment)=>[segment.id,[]])),outgoing=new Map(segments.map((segment)=>[segment.id,[]]));
  for(const edge of dependencies) {incoming.get(edge.target).push(edge);outgoing.get(edge.source).push(edge);}
  for(const edges of incoming.values())edges.sort((a,b)=>compareIds(a.source,b.source));
  for(const edges of outgoing.values())edges.sort((a,b)=>compareIds(a.target,b.target));
  const counts=new Map(segments.map((segment)=>[segment.id,incoming.get(segment.id).length]));
  const slots=new Map(segments.map((segment)=>[segment.id,0]));
  const ready=segments.filter((segment)=>counts.get(segment.id)===0).map((segment)=>segment.id).sort(compareIds);
  let maxRank=-1;
  for(let index=0;index<ready.length;index++) {
    checkCancelled(signal);
    const id=ready[index];
    for(const edge of outgoing.get(id)) {
      slots.set(edge.target,Math.max(slots.get(edge.target),slots.get(id)+1));
      maxRank=Math.max(maxRank,slots.get(edge.target));
      counts.set(edge.target,counts.get(edge.target)-1);
      if(counts.get(edge.target)===0)ready.push(edge.target);
    }
  }
  if(ready.length!==segments.length)throw new PhaseError('p5','cyclic-slot-constraints');
  const segmentById=new Map(segments.map((segment)=>[segment.id,segment]));
  const rightward=segments.filter((segment)=>!outgoing.get(segment.id).length&&!segment.incoming.length).map((segment)=>segment.id).sort(compareIds);
  const remaining=new Map(segments.map((segment)=>[segment.id,outgoing.get(segment.id).length]));
  if(maxRank>=0) {
    for(const id of rightward)slots.set(id,maxRank);
    for(let index=0;index<rightward.length;index++) {
      const id=rightward[index];
      for(const edge of incoming.get(id)) {
        if(segmentById.get(edge.source).incoming.length)continue;
        slots.set(edge.source,Math.min(slots.get(edge.source),slots.get(id)-1));
        remaining.set(edge.source,remaining.get(edge.source)-1);
        if(remaining.get(edge.source)===0)rightward.push(edge.source);
      }
    }
  }
  return {slots,topologicalOrder:ready,rightwardOrder:rightward};
}
