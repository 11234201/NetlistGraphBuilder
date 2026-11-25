import { compareIds, checkCancelled, PhaseError } from './protocol.js';
import { ORTHOGONAL_ROUTING_PROFILE as profile } from './policy.js';
import { createIntervalQuery, pairDependencies, connectionCrossings, lowerBound } from './routing_dependencies.js';
import { feedbackDependencies } from './routing_cycles.js';

const extent=(incoming,outgoing)=>({incoming,outgoing,start:Math.min(...incoming,...outgoing),end:Math.max(...incoming,...outgoing)});
const crossings=(left,right)=>connectionCrossings(left.outgoing,right)+connectionCrossings(right.incoming,left);

export function splitCriticalCycles(sourceSegments,sourceDependencies,criticalThreshold,edgeSpacing,{signal}={}) {
  const segments=sourceSegments.map((segment)=>({...segment,incoming:[...segment.incoming],outgoing:[...segment.outgoing]}));
  let dependencies=sourceDependencies;
  const byId=new Map(segments.map((segment)=>[segment.id,segment]));
  const {feedback}=feedbackDependencies(segments,dependencies,true,{signal});
  if(!feedback.length)return {segments,dependencies,decisions:[],splits:[]};
  const decisions=feedback.map((dependency)=>({action:'critical-cycle',dependency:{...dependency}}));
  const positions=segments.flatMap((segment)=>[...segment.incoming,...segment.outgoing]).sort((a,b)=>a-b);
  let areas=[];
  for(let i=1;i<positions.length;i++)if(positions[i]-positions[i-1]>=2*criticalThreshold) {
    areas.push({start:positions[i-1]+criticalThreshold,end:positions[i]-criticalThreshold});
  }
  const selected=new Map();
  for(const edge of feedback) {
    if(selected.has(edge.source)||selected.has(edge.target))continue;
    let split=byId.get(edge.source),cause=byId.get(edge.target);
    if(split.incoming.length+split.outgoing.length>2&&cause.incoming.length+cause.outgoing.length<=2)[split,cause]=[cause,split];
    selected.set(split.id,cause.id);
  }
  const ordered=[...selected].sort(([a],[b])=>byId.get(a).end-byId.get(a).start-(byId.get(b).end-byId.get(b).start)||compareIds(a,b));
  // Each half is contained by its original segment's interval. Index those
  // immutable envelopes once, then resolve a hit to the current halves.
  const envelopes = segments.map(({ id, start, end }) => ({ id, start, end }));
  const query = createIntervalQuery(envelopes);
  const halves = new Map();
  const allEdges = new Set(dependencies);
  const incident = new Map(segments.map(({ id }) => [id, new Set()]));
  const addDependency = (edge) => {
    allEdges.add(edge);
    incident.get(edge.source).add(edge);
    incident.get(edge.target).add(edge);
  };
  for (const edge of dependencies) addDependency(edge);
  const padding = Math.max(criticalThreshold, edgeSpacing * profile.conflictThresholdFactor);
  const splits=[];
  // Each selected original segment is split at most once; no repair/retry loop over product size.
  for(const [id,causeId] of ordered) {
    checkCancelled(signal);
    const segment=byId.get(id),cause=byId.get(causeId);
    const adjacent=[...incident.get(id)]
      .map((edge)=>byId.get(edge.source===id?edge.target:edge.source));
    const rate=(area)=> {
      const center=(area.start+area.end)/2;
      const first=extent(segment.incoming,[center]),second=extent([center],segment.outgoing);
      let crossingCount=crossings(first,cause)+crossings(cause,second),dependencyCount=2;
      for(const other of adjacent)for(const part of [first,second]) {
        const one=crossings(part,other),two=crossings(other,part);
        if(one===two) {if(one>0){crossingCount+=one;dependencyCount+=2;}}
        else {crossingCount+=Math.min(one,two);dependencyCount++;}
      }
      return [crossingCount,dependencyCount,-(area.end-area.start)];
    };
    const ends=areas.map((area)=>area.end),firstIndex=lowerBound(ends,segment.start);
    let bestIndex=-1,bestRating=null;
    for(let index=firstIndex;index<areas.length&&areas[index].start<=segment.end;index++) {
      const rating=rate(areas[index]);
      if(!bestRating||rating[0]<bestRating[0]||rating[0]===bestRating[0]&&(rating[1]<bestRating[1]
        ||rating[1]===bestRating[1]&&rating[2]<bestRating[2])) {bestIndex=index;bestRating=rating;}
    }
    let position=(segment.start+segment.end)/2;
    if(bestIndex>=0) {
      const area=areas[bestIndex];position=(area.start+area.end)/2;
      const replacement=[];
      if((area.end-area.start)/2>=criticalThreshold) {
        if(area.start<=position-criticalThreshold)replacement.push({start:area.start,end:position-criticalThreshold});
        if(position+criticalThreshold<=area.end)replacement.push({start:position+criticalThreshold,end:area.end});
      }
      areas=[...areas.slice(0,bestIndex),...replacement,...areas.slice(bestIndex+1)];
    }
    const partnerId=`split:${JSON.stringify([id])}`;
    const partner={id:partnerId,...extent([position],segment.outgoing),ports:[],edgeIds:[],
      splitPartner:id,splitBy:null,routingSlot:0};
    Object.assign(segment,extent(segment.incoming,[position]),{splitPartner:partnerId,splitBy:causeId});
    segments.push(partner);byId.set(partnerId,partner);
    incident.set(partnerId, new Set());
    for (const edge of incident.get(id)) {
      allEdges.delete(edge);
      incident.get(edge.source).delete(edge);
      incident.get(edge.target).delete(edge);
    }
    addDependency({source:id,target:causeId,type:'CRITICAL',weight:profile.criticalWeight});
    addDependency({source:causeId,target:partnerId,type:'CRITICAL',weight:profile.criticalWeight});
    halves.set(id, partner);
    const rebuilt = [];
    for (const part of [segment, partner]) {
      query(part.start - padding, part.end + padding, (envelope) => {
        if (envelope.id === id) return;
        for (const other of [byId.get(envelope.id), halves.get(envelope.id)]) {
          if (!other || other.id === causeId) continue;
          const [first, second] = compareIds(part.id, other.id) < 0 ? [part, other] : [other, part];
          const edges = pairDependencies(first, second, criticalThreshold, edgeSpacing);
          if (edges.length) rebuilt.push({ key: JSON.stringify([first.id, second.id]), edges });
        }
      });
    }
    rebuilt.sort((left, right) => compareIds(left.key, right.key));
    for (const { edges } of rebuilt) for (const edge of edges) addDependency(edge);
    splits.push({segment:id,causedBy:causeId,partner:partnerId,position,rating:bestRating,remainingFreeAreas:areas.map((area)=>({...area}))});
  }
  dependencies = [...allEdges];
  if(feedbackDependencies(segments,dependencies,true,{signal}).feedback.length)throw new PhaseError('p5','critical-split-did-not-resolve-cycle');
  return {segments,dependencies,decisions,splits};
}
