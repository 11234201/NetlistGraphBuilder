import { PhaseError, compareIds, checkCancelled } from '../../../src/layout/elk_native/protocol.js';
import { ORTHOGONAL_ROUTING_PROFILE as profile } from '../../../src/layout/elk_native/policy.js';

export function lowerBound(values, value, strict = false) {
  let low=0, high=values.length;
  while (low<high) { const mid=(low+high)>>>1;
    if (values[mid]<value || strict && values[mid]===value) low=mid+1; else high=mid; }
  return low;
}
export function connectionCrossings(coordinates, segment) {
  return lowerBound(coordinates,segment.end,true)-lowerBound(coordinates,segment.start);
}
function connectionConflicts(a,b,criticalThreshold,conflictThreshold) {
  let first=0, second=0, count=0;
  if (!a.length || !b.length) return 0;
  while (true) {
    const left=a[first], right=b[second];
    if (left>right-criticalThreshold && left<right+criticalThreshold) return -1;
    if (left>right-conflictThreshold && left<right+conflictThreshold) count++;
    if (left<=right && first+1<a.length) first++;
    else if (right<=left && second+1<b.length) second++;
    else return count;
  }
}
export function pairDependencies(a,b,criticalThreshold,edgeSpacing) {
  if (Math.abs(a.start-a.end)<profile.tolerance || Math.abs(b.start-b.end)<profile.tolerance) return [];
  const first=connectionConflicts(a.outgoing,b.incoming,criticalThreshold,edgeSpacing*profile.conflictThresholdFactor);
  const second=connectionConflicts(b.outgoing,a.incoming,criticalThreshold,edgeSpacing*profile.conflictThresholdFactor);
  const result=[];
  const add=(source,target,type,weight)=>result.push({ source:source.id,target:target.id,type,weight });
  if (first===-1 || second===-1) {
    if (first===-1) add(b,a,'CRITICAL',profile.criticalWeight);
    if (second===-1) add(a,b,'CRITICAL',profile.criticalWeight);
  } else {
    const one=first*profile.conflictPenalty+profile.crossingPenalty*(connectionCrossings(a.outgoing,b)+connectionCrossings(b.incoming,a));
    const two=second*profile.conflictPenalty+profile.crossingPenalty*(connectionCrossings(b.outgoing,a)+connectionCrossings(a.incoming,b));
    if (one<two) add(a,b,'REGULAR',two-one);
    else if (one>two) add(b,a,'REGULAR',one-two);
    else if (one>0) { add(a,b,'REGULAR',0); add(b,a,'REGULAR',0); }
  }
  return result;
}

// Balanced static interval index for crossing candidates; maxEnd prunes disjoint subtrees.
export function createIntervalQuery(segments) {
  const sorted=[...segments].sort((a,b)=>a.start-b.start || compareIds(a.id,b.id));
  const build=(low,high)=> {
    if (low===high) return null;
    const middle=(low+high)>>>1, left=build(low,middle), right=build(middle+1,high), segment=sorted[middle];
    return { segment,left,right,maxEnd:Math.max(segment.end,left?.maxEnd??-Infinity,right?.maxEnd??-Infinity) };
  };
  const tree=build(0,sorted.length);
  return (start,end,visit)=> {
    const stack=tree?[tree]:[];
    while(stack.length) {
      const current=stack.pop();
      if(current.maxEnd<start) continue;
      if(current.segment.start<=end && current.segment.end>=start) visit(current.segment);
      if(current.left) stack.push(current.left);
      if(current.right && current.segment.start<=end) stack.push(current.right);
    }
  };
}

export function buildDependencies(segments,criticalThreshold,edgeSpacing,{signal,focusIds}={}) {
  if(!Number.isFinite(criticalThreshold)||criticalThreshold<0||!Number.isFinite(edgeSpacing)||edgeSpacing<0) {
    throw new PhaseError('p5','invalid-dependency-policy');
  }
  const ids=new Set();
  for(const segment of segments) {
    if(typeof segment.id!=='string'||ids.has(segment.id)||![segment.start,segment.end].every(Number.isFinite)
      ||segment.start>segment.end) throw new PhaseError('p5','invalid-routing-segment',[segment.id]);
    ids.add(segment.id);
    for(const coordinates of [segment.incoming,segment.outgoing]) {
      if(!Array.isArray(coordinates)||coordinates.some((value,index)=>!Number.isFinite(value)
        ||index>0&&value<=coordinates[index-1]||value<segment.start||value>segment.end)) {
        throw new PhaseError('p5','invalid-connection-coordinates',[segment.id]);
      }
    }
  }
  const active=segments.filter((segment)=>segment.end-segment.start>=profile.tolerance).sort((a,b)=>compareIds(a.id,b.id));
  const pairs=new Map(), queryIntervals=createIntervalQuery(active);
  const collect=(a,b)=> {
    if(a.id===b.id)return;
    if(compareIds(a.id,b.id)>0)[a,b]=[b,a];
    pairs.set(JSON.stringify([a.id,b.id]),[a,b]);
  };
  const incoming=active.flatMap((segment)=>segment.incoming.map((value)=>({value,segment})))
    .sort((a,b)=>a.value-b.value||compareIds(a.segment.id,b.segment.id));
  const incomingValues=incoming.map(({value})=>value);
  const outgoing=focusIds?active.flatMap((segment)=>segment.outgoing.map((value)=>({value,segment})))
    .sort((a,b)=>a.value-b.value||compareIds(a.segment.id,b.segment.id)):[];
  const outgoingValues=outgoing.map(({value})=>value);
  const padding=Math.max(criticalThreshold,edgeSpacing*profile.conflictThresholdFactor);
  // Every candidate is either interval overlap (possible crossing), or opposite-side proximity (possible conflict).
  // No graph-size retry or unconditional segment-pair scan; work is output-sensitive to exact interaction candidates.
  for(const segment of active) {
    if(focusIds&&!focusIds.has(segment.id))continue;
    checkCancelled(signal);
    queryIntervals(segment.start,segment.end,(other)=>collect(segment,other));
    for(const coordinate of segment.outgoing) {
      const start=lowerBound(incomingValues,coordinate-padding,true), end=lowerBound(incomingValues,coordinate+padding);
      for(let index=start;index<end;index++)collect(segment,incoming[index].segment);
    }
    if(focusIds)for(const coordinate of segment.incoming) {
      const start=lowerBound(outgoingValues,coordinate-padding,true),end=lowerBound(outgoingValues,coordinate+padding);
      for(let index=start;index<end;index++)collect(segment,outgoing[index].segment);
    }
  }
  const dependencies=[];
  for(const [, [a,b]] of [...pairs].sort(([a],[b])=>compareIds(a,b))) {
    checkCancelled(signal);
    dependencies.push(...pairDependencies(a,b,criticalThreshold,edgeSpacing));
  }
  return { dependencies,candidatePairCount:pairs.size,segmentCount:segments.length };
}


