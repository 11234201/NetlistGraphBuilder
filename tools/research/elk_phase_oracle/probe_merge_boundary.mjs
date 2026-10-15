import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {properInputFromOracle,graphInOracleOrder} from './upstream_proper_input.mjs';
import {mergeHyperedgeDummies} from '../../../src/layout/elk_native/hyperedge_merge.js';
import {createQualityBaseline,sha256} from './quality_baseline.mjs';

const sorted=values=>values.toSorted((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
function signature(graph,raw=false){
  const nodes=raw?graph.components.flatMap(component=>component.nodes):graph.nodes;
  const edges=raw?graph.components.flatMap(component=>component.edges):graph.edges;
  const keys=new Map(nodes.map(node=>[node.id,node.kind==='long_edge'?
    JSON.stringify([sorted(node.lineage),node.layer,raw?node.box.height:node.height]):node.id]));
  const ports=new Map(nodes.flatMap(node=>node.ports.map(port=>[port.id,node.kind==='long_edge'?
    `${keys.get(node.id)}:${port.side}`:port.id])));
  return {nodes:sorted(nodes.map(node=>({key:keys.get(node.id),layer:node.layer,order:node.order,
    width:raw?node.box.width:node.width,height:raw?node.box.height:node.height,
    ports:sorted(node.ports.map(port=>({key:ports.get(port.id),side:port.side,order:port.order,
      x:raw?port.box.x:port.x,y:raw?port.box.y:port.y,width:raw?port.box.width:port.width,height:raw?port.box.height:port.height,
      anchor:port.anchor})))}))),
    edges:sorted(edges.map(edge=>({logical:edge.logicalEdgeId,net:edge.physicalNetId,
      source:ports.get(edge.sourcePortId),target:ports.get(edge.targetPortId),reversed:edge.reversed})))};
}
export function probeMergeBoundary(oracle){
  const index=oracle.snapshots.findIndex(snapshot=>snapshot.processor.className?.endsWith('HyperedgeDummyMerger'));
  assert.ok(index>0,'merge boundary absent');
  const input=graphInOracleOrder(properInputFromOracle(oracle),oracle.snapshots[index-1]),before=JSON.stringify(input);
  const merged=mergeHyperedgeDummies(input),native=signature(merged),source=signature(oracle.snapshots[index],true);
  assert.equal(JSON.stringify(input),before);
  return {caseId:oracle.fixture.caseId,inputProcessor:oracle.snapshots[index-1].processor.className,
    mergedCount:merged.phaseData.mergedDummyCount,matches:JSON.stringify(native)===JSON.stringify(source),native,source};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [file,output]=process.argv.slice(2);
  if(!output)throw Error('usage: probe_merge_boundary.mjs <oracle> <output-dir>');
  await mkdir(output,{recursive:true});
  const root=fileURLToPath(new URL('../../../',import.meta.url)),before=await createQualityBaseline(root,'merge_boundary');
  const bytes=await readFile(file),report=probeMergeBoundary(JSON.parse(bytes.toString('utf8')));
  await writeFile(`${output}/report.json`,JSON.stringify({...report,oracleDigest:sha256(bytes)},null,2));
  const after=await createQualityBaseline(root,'merge_boundary_after');
  await writeFile(`${output}/baseline.before.json`,JSON.stringify(before,null,2));
  await writeFile(`${output}/baseline.after.json`,JSON.stringify(after,null,2));
  assert.equal(before.fileSetDigest,after.fileSetDigest);
  console.log(JSON.stringify({caseId:report.caseId,matches:report.matches,mergedCount:report.mergedCount}));
}
