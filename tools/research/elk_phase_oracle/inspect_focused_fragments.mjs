import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildFocusedFaninTreeBlocks } from '../../../src/layout/layered/focusedTreeBlocks.js';

// Diagnose the existing acceptance predicate without changing its definition.
const directory=resolve(process.argv[2]??'dc_runs/elk_native_acceptance');
const caseId=process.argv[3]??'eq012_1471_focused_3_3';
for(const provider of ['elk-layered','native-layered']){
  const graph=JSON.parse(await readFile(resolve(directory,`${caseId}.${provider}.graph.json`),'utf8'));
  const decomposition=buildFocusedFaninTreeBlocks(graph.nodes,graph.edges);
  const byId=new Map(graph.nodes.map((node)=>[node.id,node]));
  const ordered=decomposition.entries.map((entry)=>({entry,node:byId.get(entry.nodeId)}))
    .sort((a,b)=>a.node.x-b.node.x||a.node.id.localeCompare(b.node.id));
  const columns=[];let anchor=null;
  for(const item of ordered){
    if(anchor===null||Math.abs(item.node.x-anchor)>2){columns.push([]);anchor=item.node.x;}
    columns.at(-1).push(item);
  }
  const fragments=[];
  columns.forEach((column,rank)=>{
    column.sort((a,b)=>a.node.y-b.node.y||a.node.id.localeCompare(b.node.id));
    const runs=new Map();let previous=null;
    for(const {entry,node} of column){
      if(entry.membershipKey!==previous){
        const group=runs.get(entry.membershipKey)??{ownerIds:entry.ownerIds,shared:entry.shared,intervals:[]};
        group.intervals.push([]);runs.set(entry.membershipKey,group);previous=entry.membershipKey;
      }
      runs.get(entry.membershipKey).intervals.at(-1).push({id:node.id,y:node.y});
    }
    for(const group of runs.values())if(group.intervals.length>1)fragments.push({rank,...group});
  });
  console.log(JSON.stringify({caseId,provider,branchRootIds:decomposition.branchRootIds,
    exclusiveFragments:fragments.filter(({shared})=>!shared).length,
    sharedFragments:fragments.filter(({shared})=>shared).length,
    fragments:process.argv.includes('--details')?fragments:fragments.map(({rank,ownerIds,shared,intervals})=>
      ({rank,ownerIds,shared,intervalSizes:intervals.map((interval)=>interval.length)}))}));
}
