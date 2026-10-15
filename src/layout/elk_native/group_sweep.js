import {requireOrderGroup,requireEqualOrderGroup} from './order_group_contract.js';
import {forecastOrderGroupBands} from './order_group_bands.js';
export function createGroupSweepContext(graph,entries){
  const nodeIds=new Set(graph.nodes.map(node=>node.id));
  requireEqualOrderGroup(new Set(entries.map(entry=>entry.nodeId)).size,entries.length);
  entries=entries.filter(entry=>nodeIds.has(entry.nodeId));
  const membership=new Map(entries.map(entry=>[entry.nodeId,entry.membershipKey]));
  const forecast=forecastOrderGroupBands(graph,entries),bandsByRank=new Map();
  for(const band of forecast.bands){
    if(!bandsByRank.has(band.rank))bandsByRank.set(band.rank,[]);
    bandsByRank.get(band.rank).push({nodeIds:band.nodeIds,membership});
  }
  return {bandsByRank};
}
export function cohereBandIds(ids,states,bands){
  const result=[...ids],positions=new Map(ids.map((id,index)=>[id,index])),covered=new Set();
  for(const band of bands){
    const members=band.nodeIds.toSorted((a,b)=>positions.get(a)-positions.get(b)),groups=new Map();
    for(const id of members){
      requireOrderGroup(positions.has(id)&&states.has(id),'missing group state');requireOrderGroup(!covered.has(id),'overlapping group band');covered.add(id);
      const state=states.get(id);requireOrderGroup(Number.isFinite(state.value),'non-finite group barycenter');
      const key=band.membership.get(id);requireEqualOrderGroup(typeof key,'string');
      if(!groups.has(key))groups.set(key,{key,ids:[],sum:0,degree:0});
      const group=groups.get(key),weight=state.degree>0?state.degree:1;
      group.ids.push(id);group.sum+=state.value*weight;group.degree+=weight;
    }
    const ordered=[...groups.values()].toSorted((a,b)=>a.sum/a.degree-b.sum/b.degree||(a.key<b.key?-1:a.key>b.key?1:0)).flatMap(group=>group.ids);
    members.forEach((id,index)=>{result[positions.get(id)]=ordered[index];});
  }
  return result;
}
// Research adaptation: groups and singleton nodes share one layer-wide ordering.
// Unlike the slot policy, singleton/dummy positions are not an extra constraint.
export function cohereLayoutUnits(ids,states,bands){
  const owners=new Map(),positions=new Map(ids.map((id,index)=>[id,index]));
  requireEqualOrderGroup(positions.size,ids.length,'duplicate layer node');
  bands.forEach((band,index)=>{
    for(const id of band.nodeIds){
      requireOrderGroup(positions.has(id),'missing unit member');requireOrderGroup(!owners.has(id),'overlapping group band');
      const membership=band.membership.get(id);requireEqualOrderGroup(typeof membership,'string');
      owners.set(id,JSON.stringify(['group',index,membership]));
    }
  });
  if(!owners.size)return [...ids];
  const units=new Map();
  for(const id of ids){
    const state=states.get(id);requireOrderGroup(state&&Number.isFinite(state.value),'missing or invalid unit state');
    const key=owners.get(id)??JSON.stringify(['singleton',id]);
    if(!units.has(key))units.set(key,{key,ids:[],sum:0,degree:0});
    const unit=units.get(key),weight=state.degree>0?state.degree:1;
    unit.ids.push(id);unit.sum+=state.value*weight;unit.degree+=weight;
  }
  return [...units.values()].toSorted((a,b)=>a.sum/a.degree-b.sum/b.degree||(a.key<b.key?-1:a.key>b.key?1:0))
    .flatMap(unit=>unit.ids);
}
