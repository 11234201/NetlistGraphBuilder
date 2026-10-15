import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {getRouteSegments} from '../../../src/layout/orthogonalRouting.js';
const [root,caseId]=process.argv.slice(2);
if(!root||!caseId)throw new Error('usage: inspect_quality_routes.mjs <completed-run-dir> <case-id>');
const reference=JSON.parse(await readFile(path.join(root,`${caseId}.elk-layered.graph.json`),'utf8'));
const candidate=JSON.parse(await readFile(path.join(root,`${caseId}.native-layered.graph.json`),'utf8'));
const byId=new Map(reference.edges.map((edge)=>[edge.id,edge]));
const bends=(edge)=>Math.max(0,getRouteSegments(edge.points).length-1);
const ranked=candidate.edges.map((edge)=>({edge,reference:byId.get(edge.id),bends:bends(edge),referenceBends:bends(byId.get(edge.id))}))
  .sort((a,b)=>b.bends-a.bends||a.edge.id.localeCompare(b.edge.id));
const cellIds=candidate.nodes.filter((node)=>node.kind==='cell').map((node)=>node.id).sort();
const report={caseId,focusId:cellIds[Math.floor(cellIds.length/2)],
  worst:ranked.slice(0,5).map(({edge,reference,bends,referenceBends})=>({id:edge.id,source:edge.source,target:edge.target,
    sourcePin:edge.sourcePin,targetPin:edge.targetPin,net:edge.net,bends,referenceBends,
    candidatePoints:edge.points,referencePoints:reference.points})),
  worsenedCount:ranked.filter((item)=>item.bends>item.referenceBends).length};
await writeFile(path.join(root,`${caseId}.route_witness.json`),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,worst:report.worst.map(({candidatePoints,referencePoints,...entry})=>entry)}));
