import {requireOrderGroup,requireEqualOrderGroup,ORDER_GROUP_POLICY} from './order_group_contract.js';
import {preparePortGeometry} from './port_geometry.js';
import {measureLayerAlignment} from './layer_alignment.js';
// Forecast of measured local alignment; no y, route, slot or future graph is read.
// Keep the existing explicit exclusions until a wider forecast contract is verified.
export function forecastOrderGroupBands(graph,entries,{tolerance=ORDER_GROUP_POLICY.groupBandTolerance}={}){
  requireEqualOrderGroup(graph.selfLoops.length,0,'self-loop margins need an explicit measured forecast');
  requireOrderGroup(graph.options.nodeNodeBetweenLayers>tolerance,'visual columns can merge across ranks');
  const measured=preparePortGeometry(graph),{offsets}=measureLayerAlignment(measured);
  const members=new Set(entries.map(entry=>entry.nodeId)),bands=[];
  for(const layer of graph.layers){
    const ordered=layer.nodeIds.filter(id=>members.has(id)).toSorted((a,b)=>offsets.get(a)-offsets.get(b)||(a<b?-1:a>b?1:0));
    const bandById=new Map();let anchor=null,band=-1;
    for(const id of ordered){const offset=offsets.get(id);if(anchor===null||Math.abs(offset-anchor)>tolerance){anchor=offset;band++;}
      bandById.set(id,band);}
    for(let index=0;index<=band;index++)bands.push({index:bands.length,rank:layer.index,band:index,
      nodeIds:layer.nodeIds.filter(id=>bandById.get(id)===index)});
  }
  return {bands,offsets:[...offsets].toSorted(([a],[b])=>a<b?-1:a>b?1:0)};
}
