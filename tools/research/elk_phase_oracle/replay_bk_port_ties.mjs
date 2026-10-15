import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileBoundaryProbe} from './probe_bk_boundary_threshold.mjs';
import {probeBkFromOracle} from './probe_bk_from_oracle.mjs';
import {compareBkDecisions} from './compare_bk_decisions.mjs';
import {createQualityBaseline} from './quality_baseline.mjs';

// Only a causal research replay: eligibility remains inside the unchanged pick
// function, and the owned clockwise port order is never reordered.
export function createPortTieReplay(oracle,trace){
  assert.equal(trace.traceVersion,'1.0.0');assert.equal(trace.caseId,oracle.fixture.caseId);
  assert.equal(trace.sourceCommit,oracle.producer.sourceCommit);assert.equal(trace.inputDigest,oracle.fixture.inputDigest);
  const p4=oracle.snapshots.findIndex((snapshot)=>snapshot.boundary==='p4');assert.ok(p4>0);
  assert.equal(oracle.snapshots[p4-1].components.length,1);
  const ids=oracle.snapshots[p4-1].components[0].layers.flatMap((layer)=>layer.nodeIds),preferred=new Map();
  const key=(direction,free,isRoot)=>JSON.stringify([direction,free,isRoot]);
  for(const row of trace.events.filter((row)=>['bound-pick','post-pick'].includes(row.event)&&row.edge)){
    const free=ids[row.freeIndex];assert.ok(free);
    const edgeKey=JSON.stringify([ids[row.edge.sourceIndex],row.edge.sourcePortOrder,ids[row.edge.targetIndex],row.edge.targetPortOrder]);
    const decisionKey=key(row.direction,free,row.isRoot);
    assert.ok(!preferred.has(decisionKey)||preferred.get(decisionKey)===edgeKey,'conflicting replay choices require a richer source trace');
    preferred.set(decisionKey,edgeKey);
  }
  return (free,isRoot,incident,context,layout)=>{
    const wanted=preferred.get(key(layout.horizontal+layout.vertical,free,isRoot));
    if(!wanted)return incident;
    const owner=(edge)=>context.ports.get(edge.sourceNodeId===free?edge.sourcePortId:edge.targetPortId);
    const shape=(edge)=>JSON.stringify([edge.sourceNodeId,context.ports.get(edge.sourcePortId).order,
      edge.targetNodeId,context.ports.get(edge.targetPortId).order]);
    const priority=new Map(incident.map((edge,index)=>[edge.id,{index,preferred:shape(edge)===wanted}]));
    assert.ok([...priority.values()].some((row)=>row.preferred),'recorded replay choice absent at pre-P4');
    return incident.toSorted((a,b)=>owner(a).order-owner(b).order
      ||Number(priority.get(b.id).preferred)-Number(priority.get(a.id).preferred)||priority.get(a.id).index-priority.get(b.id).index);
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [oracleFile,traceFile,output]=process.argv.slice(2);if(!output)throw new Error('usage: replay_bk_port_ties.mjs <oracle.json> <sidecar.json> <output-dir>');
  await mkdir(output,{recursive:true});
  const root=fileURLToPath(new URL('../../../',import.meta.url)),before=await createQualityBaseline(root,'q03_bk_port_replay');
  await writeFile(path.join(output,'baseline.before.json'),JSON.stringify(before,null,2));
  const [oracle,trace]=await Promise.all([oracleFile,traceFile].map(async(file)=>JSON.parse(await readFile(file,'utf8'))));
  const events=[],compactor=await compileBoundaryProbe({events,orderIncident:createPortTieReplay(oracle,trace)});
  const report={...probeBkFromOracle(oracle,{compactor}),events};
  const comparison=compareBkDecisions(oracle,trace,{report});
  await writeFile(path.join(output,'report.json'),JSON.stringify({scope:'diagnostic same-owned-port tie replay; no eligibility bypass or production policy change',report,comparison},null,2));
  console.log(JSON.stringify({matches:report.matches,allDecisionsMatch:comparison.allDecisionsMatch,
    reports:comparison.reports.map(({affected,...row})=>row)}));
  const after=await createQualityBaseline(root,'q03_bk_port_replay_after');
  await writeFile(path.join(output,'baseline.after.json'),JSON.stringify(after,null,2));assert.equal(after.fileSetDigest,before.fileSetDigest);
}
