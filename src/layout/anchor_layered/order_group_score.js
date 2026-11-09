import {requireOrderGroup,requireEqualOrderGroup} from './order_group_contract.js';
export function scoreOrderGroups(layers,entries){
  const membership=new Map();
  for(const {nodeId,membershipKey} of entries){
    requireEqualOrderGroup(typeof nodeId,'string');requireEqualOrderGroup(typeof membershipKey,'string');
    requireOrderGroup(!membership.has(nodeId),'duplicate group member');membership.set(nodeId,membershipKey);
  }
  const seen=new Set(),reports=[];
  for(const {index,nodeIds} of layers){
    let previous=null;const runs=new Map();
    for(const id of nodeIds){
      requireOrderGroup(!seen.has(id),'duplicate ordered node');seen.add(id);
      if(!membership.has(id))continue;
      const key=membership.get(id);
      if(key!==previous)runs.set(key,(runs.get(key)??0)+1);
      previous=key;
    }
    reports.push({index,fragmentedGroups:[...runs.values()].filter(count=>count>1).length,
      extraIntervals:[...runs.values()].reduce((sum,count)=>sum+count-1,0),
      intervals:[...runs].toSorted(([a],[b])=>a<b?-1:a>b?1:0)});
  }
  requireOrderGroup([...membership.keys()].every(id=>seen.has(id)),'missing group member');
  return {fragmentedGroupCount:reports.reduce((sum,layer)=>sum+layer.fragmentedGroups,0),
    extraIntervals:reports.reduce((sum,layer)=>sum+layer.extraIntervals,0),layers:reports};
}
