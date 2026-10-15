import { compareIds, checkCancelled, PhaseError } from './protocol.js';
import { ORTHOGONAL_ROUTING_PROFILE as profile } from './policy.js';
import { buildDependencies, connectionCrossings, lowerBound } from './routing_dependencies.js';
import { feedbackDependencies } from './routing_cycles.js';

const extent=(incoming,outgoing)=>({incoming,outgoing,start:Math.min(...incoming,...outgoing),end:Math.max(...incoming,...outgoing)});
const crossings=(left,right)=>connectionCrossings(left.outgoing,right)+connectionCrossings(right.incoming,left);

export function splitCriticalCycles(sourceSegments,sourceDependencies,criticalThreshold,edgeSpacing,{signal}={}) {
  const segments=sourceSegments.map((segment)=>({...segment,incoming:[...segment.incoming],outgoing:[...segment.outgoing]}));
  let dependencies=sourceDependencies.map((edge)=>({...edge}));
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
  const splits=[];
  // Each selected original segment is split at most once; no repair/retry loop over product size.
  for(const [id,causeId] of ordered) {
    checkCancelled(signal);
    const segment=byId.get(id),cause=byId.get(causeId);
    const adjacent=dependencies.filter((edge)=>edge.source===id||edge.target===id)
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
    dependencies=dependencies.filter((edge)=>edge.source!==id&&edge.target!==id);
    dependencies.push({source:id,target:causeId,type:'CRITICAL',weight:profile.criticalWeight},
      {source:causeId,target:partnerId,type:'CRITICAL',weight:profile.criticalWeight});
    // Rebuild only interactions touching either split half, discovered by the exact shared index.
    const rebuilt=buildDependencies(segments,criticalThreshold,edgeSpacing,
      {signal,focusIds:new Set([id,partnerId])}).dependencies;
    for(const edge of rebuilt) {
      if(![id,partnerId].includes(edge.source)&&![id,partnerId].includes(edge.target))continue;
      const other=[id,partnerId].includes(edge.source)?edge.target:edge.source;
      if(other===id||other===partnerId||other===causeId)continue;
      dependencies.push(edge);
    }
    splits.push({segment:id,causedBy:causeId,partner:partnerId,position,rating:bestRating,remainingFreeAreas:areas.map((area)=>({...area}))});
  }
  if(feedbackDependencies(segments,dependencies,true,{signal}).feedback.length)throw new PhaseError('p5','critical-split-did-not-resolve-cycle');
  return {segments,dependencies,decisions,splits};
}
