import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {properInputFromOracle,graphInOracleOrder} from './upstream_proper_input.mjs';
import {createQualityBaseline,sha256} from './quality_baseline.mjs';
import {countCrossings} from '../../../src/layout/elk_native/crossing_counter.js';
import {orderLayers} from '../../../src/layout/elk_native/p3_ordering.js';
import {mergeHyperedgeDummies} from '../../../src/layout/elk_native/hyperedge_merge.js';
import {preparePortGeometry} from '../../../src/layout/elk_native/port_geometry.js';
import {placeNodes} from '../../../src/layout/elk_native/p4_placement.js';

const [oracleFile,edgeId,output]=process.argv.slice(2);
if(!output)throw new Error('usage: isolate_p3_quality.mjs <oracle.json> <logical-edge-id> <output-dir>');
await mkdir(output,{recursive:true});
const repoRoot=fileURLToPath(new URL('../../../',import.meta.url)),baseline=await createQualityBaseline(repoRoot,'q03_p3_isolation');
await writeFile(path.join(output,'baseline.before.json'),JSON.stringify(baseline,null,2));
const bytes=await readFile(oracleFile),oracle=JSON.parse(bytes.toString('utf8'));
const input=properInputFromOracle(oracle),inputBefore=JSON.stringify(input);
const rawP3=oracle.snapshots.find((snapshot)=>snapshot.boundary==='p3');
const expected=rawP3.phaseData.events.filter((event)=>event.event==='attempt'&&event.retained).at(-1).crossings;
const sourceOrder=graphInOracleOrder(input,rawP3),referenceCount=countCrossings(sourceOrder);
assert.equal(referenceCount,expected,'crossing counter mismatch on actual retained upstream order');
const selected=orderLayers(input),attempts=new Map();
for(const event of selected.phaseData.events.filter((event)=>event.event==='candidate'&&event.retained))attempts.set(event.attempt,event);
function withOrder(layers){
  const positions=new Map(layers.flatMap((ids)=>ids.map((id,order)=>[id,order])));
  return {...input,nodes:input.nodes.map((node)=>({...node,order:positions.get(node.id)})),
    layers:layers.map((nodeIds,index)=>({index,nodeIds})),phase:'p3'};
}
const scenarios=[{name:'upstream-retained',graph:sourceOrder},{name:'candidate-selected',graph:selected},
  ...[...attempts].map(([attempt,event])=>({name:`candidate-attempt-${attempt}`,model:event.model,graph:withOrder(event.layers)}))];
const reports=[];
for(const {name,model,graph} of scenarios){
  const merged=mergeHyperedgeDummies(graph),placed=placeNodes(preparePortGeometry(merged));
  const chain=placed.chains.find((chain)=>chain.logicalEdgeId===edgeId);assert.ok(chain,'tracked logical chain missing');
  const nodes=new Map(placed.nodes.map((node)=>[node.id,node])),tracked=chain.dummyNodeIds.map((id)=>nodes.get(id));
  const candidates=placed.phaseData.candidates.map((candidate)=>{
    const root=new Map(candidate.root),y=new Map(candidate.nodeY);
    return {direction:candidate.direction,size:candidate.size,feasible:candidate.feasible,
      distinctDummyY:new Set(tracked.map((node)=>y.get(node.id))).size,
      dummyRoots:new Set(tracked.map((node)=>root.get(node.id))).size};
  });
  const report={name,model,crossings:countCrossings(graph),mergedDummies:merged.phaseData.mergedDummyCount,
    dummyCount:tracked.length,selected:placed.phaseData.selected,
    distinctDummyY:new Set(tracked.map((node)=>node.y)).size,candidates,
    chain:tracked.map(({id,layer,order,y})=>({id,layer,order,y}))};
  reports.push(report);
  console.log(JSON.stringify({...report,chain:undefined}));
}
assert.equal(JSON.stringify(input),inputBefore,'diagnostic input mutated');
const result={caseId:oracle.fixture.caseId,edgeId,oracleDigest:sha256(bytes),oracleInputDigest:oracle.fixture.inputDigest,
  boundary:'same upstream pre-P3 ranks/ports/initial order; no production adapter or P5 quality claim',
  referenceCrossings:referenceCount,initialCrossings:countCrossings(input),reports};
await writeFile(path.join(output,'report.json'),JSON.stringify(result,null,2));
const after=await createQualityBaseline(repoRoot,'q03_p3_isolation_after');
await writeFile(path.join(output,'baseline.after.json'),JSON.stringify(after,null,2));
assert.equal(after.fileSetDigest,baseline.fileSetDigest,'source/input/tool snapshot changed');
