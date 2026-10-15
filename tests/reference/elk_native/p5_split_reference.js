import { referenceFeedback } from './p5_feedback_reference.js';
import { referenceDependencies } from './p5_dependency_reference.js';
const compare=(a,b)=>a<b?-1:a>b?1:0;
const extent=(incoming,outgoing)=>({incoming,outgoing,start:Math.min(...incoming,...outgoing),end:Math.max(...incoming,...outgoing)});
const crossings=(a,b)=>a.outgoing.filter((y)=>y>=b.start&&y<=b.end).length+
  b.incoming.filter((y)=>y>=a.start&&y<=a.end).length;
const compareTuple=(a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2];

// Small, deliberately exhaustive reference. Scan every free area and every
// pair after a split; no production index, binary search, heap or predicate.
export function referenceSplits(input,dependencies,threshold,spacing){
  if(input.length>10)throw new Error('bounded split reference: at most 10 segments');
  let segments=structuredClone(input),arcs=structuredClone(dependencies);
  const feedback=referenceFeedback(segments,arcs,true).feedback;
  const decisions=feedback.map((dependency)=>({action:'critical-cycle',dependency:{...dependency}}));
  const byId=()=>new Map(segments.map((segment)=>[segment.id,segment]));
  let lookup=byId();const selected=new Map();
  for(const arc of feedback){
    if(selected.has(arc.source)||selected.has(arc.target))continue;
    let a=lookup.get(arc.source),b=lookup.get(arc.target);
    if(a.incoming.length+a.outgoing.length>2&&b.incoming.length+b.outgoing.length<=2)[a,b]=[b,a];
    selected.set(a.id,b.id);
  }
  const points=segments.flatMap((segment)=>[...segment.incoming,...segment.outgoing]).sort((a,b)=>a-b);
  let areas=points.slice(1).flatMap((value,index)=>value-points[index]>=2*threshold?
    [{start:points[index]+threshold,end:value-threshold}]:[]);
  const splits=[];
  const order=[...selected].sort(([a],[b])=>lookup.get(a).end-lookup.get(a).start-
    (lookup.get(b).end-lookup.get(b).start)||compare(a,b));
  for(const [id,causeId] of order){
    lookup=byId();const original=lookup.get(id),cause=lookup.get(causeId);
    const adjacent=arcs.filter((arc)=>arc.source===id||arc.target===id)
      .map((arc)=>lookup.get(arc.source===id?arc.target:arc.source));
    const candidates=areas.map((area,index)=>{
      const position=(area.start+area.end)/2;
      const halves=[extent(original.incoming,[position]),extent([position],original.outgoing)];
      let cross=crossings(halves[0],cause)+crossings(cause,halves[1]),deps=2;
      for(const other of adjacent)for(const half of halves){
        const a=crossings(half,other),b=crossings(other,half);
        if(a!==b){cross+=Math.min(a,b);deps++;}
        else if(a>0){cross+=a;deps+=2;}
      }
      return {area,index,position,rating:[cross,deps,-(area.end-area.start)]};
    }).filter(({area})=>area.end>=original.start&&area.start<=original.end);
    candidates.sort((a,b)=>compareTuple(a.rating,b.rating)||a.index-b.index);
    const choice=candidates[0],position=choice?.position??(original.start+original.end)/2;
    if(choice){
      const halves=(choice.area.end-choice.area.start)/2>=threshold?
        [{start:choice.area.start,end:position-threshold},{start:position+threshold,end:choice.area.end}]
          .filter((area)=>area.start<=area.end):[];
      areas=areas.flatMap((area,index)=>index===choice.index?halves:[area]);
    }
    const partner=`split:${JSON.stringify([id])}`;
    segments=segments.map((segment)=>segment.id===id?{...segment,...extent(original.incoming,[position]),
      splitPartner:partner,splitBy:causeId}:segment);
    segments.push({id:partner,...extent([position],original.outgoing),ports:[],edgeIds:[],
      splitPartner:id,splitBy:null,routingSlot:0});
    arcs=arcs.filter((arc)=>arc.source!==id&&arc.target!==id);
    arcs.push({source:id,target:causeId,type:'CRITICAL',weight:1},{source:causeId,target:partner,type:'CRITICAL',weight:1});
    for(const arc of referenceDependencies(segments,threshold,spacing)){
      const touches=arc.source===id||arc.source===partner||arc.target===id||arc.target===partner;
      const other=arc.source===id||arc.source===partner?arc.target:arc.source;
      if(touches&&![id,partner,causeId].includes(other))arcs.push(arc);
    }
    splits.push({segment:id,causedBy:causeId,partner,position,rating:choice?.rating??null,
      remainingFreeAreas:structuredClone(areas)});
  }
  if(referenceFeedback(segments,arcs,true).feedback.length)return {unresolved:true};
  return {segments,dependencies:arcs,decisions,splits};
}
