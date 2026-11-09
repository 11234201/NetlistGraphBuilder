import {requireOrderGroup,requireEqualOrderGroup,ORDER_GROUP_POLICY} from './order_group_contract.js';
import {freezeRecord} from './protocol.js';
import {countCrossings} from './crossing_counter.js';
import {forecastOrderGroupBands} from './order_group_bands.js';
import {scoreOrderGroups} from './order_group_score.js';
import {validateProperGraph} from './validate_proper.js';
export function buildOrderGroupCandidates(graph,entries,bands){
  const membership=new Map(entries.map(entry=>[entry.nodeId,entry.membershipKey]));
  requireEqualOrderGroup(membership.size,entries.length);
  const byRank=new Map(graph.layers.map(layer=>[layer.index,layer]));
  const rankById=new Map(graph.layers.flatMap(layer=>layer.nodeIds.map(id=>[id,layer.index])));
  const originalPositions=new Map(graph.layers.flatMap(layer=>layer.nodeIds.map((id,index)=>[id,index])));
  const covered=new Set();
  for(const band of bands)for(const id of band.nodeIds){
    requireOrderGroup(byRank.has(band.rank)&&rankById.get(id)===band.rank&&membership.has(id));
    requireOrderGroup(!covered.has(id),'overlapping bands');covered.add(id);
  }
  requireEqualOrderGroup(covered.size,membership.size,'uncovered memberships');
  return ['original','band-first','band-center'].map(policy=>{
    const layers=graph.layers.map(layer=>({...layer,nodeIds:[...layer.nodeIds]})),layerByRank=new Map(layers.map(layer=>[layer.index,layer]));
    if(policy!=='original')for(const band of bands){
      const layer=layerByRank.get(band.rank),positions=originalPositions;
      const ids=band.nodeIds.toSorted((a,b)=>positions.get(a)-positions.get(b)),groups=new Map();
      for(const id of ids){const key=membership.get(id);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(id);}
      const center=group=>group.reduce((sum,id)=>sum+positions.get(id),0)/group.length;
      const ordered=[...groups].toSorted(([a,left],[b,right])=>
        (policy==='band-first'?positions.get(left[0])-positions.get(right[0]):center(left)-center(right))||(a<b?-1:a>b?1:0)).flatMap(([,group])=>group);
      ids.forEach((id,index)=>{layer.nodeIds[positions.get(id)]=ordered[index];});
    }
    const positions=new Map(layers.flatMap(layer=>layer.nodeIds.map((id,order)=>[id,order])));
    const nodes=graph.nodes.map(node=>({...node,order:positions.get(node.id)}));
    return {policy,graph:{...graph,nodes,layers}};
  });
}
export function selectOrderGroupCandidate(graph,entries,{extraCandidates=[]}={}){
  validateProperGraph(graph);requireOrderGroup(Object.isFrozen(graph),'P3 boundary must be immutable');
  requireOrderGroup(extraCandidates.length<=ORDER_GROUP_POLICY.extraCandidateLimit,'fixed candidate budget exceeded');
  for(const candidate of extraCandidates){validateProperGraph(candidate.graph);
    requireEqualOrderGroup(JSON.stringify(candidate.graph.edges),JSON.stringify(graph.edges),'candidate changed topology');
    requireEqualOrderGroup(candidate.graph.inputDigest,graph.inputDigest);
    const semantic=nodes=>JSON.stringify(nodes.map(({order,...node})=>node).toSorted((a,b)=>a.id<b.id?-1:a.id>b.id?1:0));
    requireEqualOrderGroup(semantic(candidate.graph.nodes),semantic(graph.nodes),'candidate changed measured node or ports');
  }
  const before=JSON.stringify(graph),forecast=forecastOrderGroupBands(graph,entries);
  const baselineCrossings=countCrossings(graph),evidence=[];
  requireEqualOrderGroup(baselineCrossings,graph.phaseData.crossings);
  let selected=null,selectedTuple=null;
  for(const candidate of [...buildOrderGroupCandidates(graph,entries,forecast.bands),...extraCandidates]){
    const positions=new Map(candidate.graph.layers.flatMap(layer=>layer.nodeIds.map((id,index)=>[id,index])));
    const valid=(graph.orderConstraints??[]).every(({before,after})=>positions.get(before)<positions.get(after));
    const crossings=countCrossings(candidate.graph),orderedBands=forecast.bands.map(band=>({...band,
      nodeIds:band.nodeIds.toSorted((a,b)=>positions.get(a)-positions.get(b))}));
    const score=scoreOrderGroups(orderedBands,entries),admissible=valid&&crossings<=baselineCrossings;
    const tuple=[score.fragmentedGroupCount,score.extraIntervals,crossings,JSON.stringify(candidate.graph.layers)];
    evidence.push({policy:candidate.policy,valid,crossings,admissible,score,layers:candidate.graph.layers});
    const less=(a,b)=>{for(let i=0;i<a.length;i++){if(a[i]<b[i])return true;if(a[i]>b[i])return false;}return false;};
    if(admissible&&(!selected||less(tuple,selectedTuple))){selected=candidate;selectedTuple=tuple;}
  }
  requireOrderGroup(selected,'no admissible original candidate');requireEqualOrderGroup(JSON.stringify(graph),before);
  const result={...selected.graph,phaseData:{...selected.graph.phaseData,crossings:selectedTuple[2],
    researchCohesion:{policy:selected.policy,scoreTuple:selectedTuple.slice(0,3),baselineCrossings,candidates:evidence}}};
  validateProperGraph(result);return freezeRecord(result);
}
