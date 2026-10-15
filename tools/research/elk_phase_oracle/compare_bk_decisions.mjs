import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './quality_baseline.mjs';

const directions=['RIGHTDOWN','RIGHTUP','LEFTDOWN','LEFTUP'];
export const BK_DECISION_COORDINATE_TOLERANCE=1e-7;
const coordinateFields=new Set(['previousThreshold','blockY','delta','available']);
const sameEvent=(left,right)=>left!==undefined&&right!==undefined&&
  JSON.stringify(Object.keys(left))===JSON.stringify(Object.keys(right))&&Object.keys(left).every((key)=>
    coordinateFields.has(key)&&typeof left[key]==='number'&&typeof right[key]==='number'
      ?Math.abs(left[key]-right[key])<=BK_DECISION_COORDINATE_TOLERANCE:JSON.stringify(left[key])===JSON.stringify(right[key]));

export function compareObservationSnapshots(before,after){
  assert.equal(before.producer.sourceCommit,after.producer.sourceCommit);
  assert.equal(before.schemaVersion,after.schemaVersion);
  const digest=(oracle)=>{
    const {producer,...payload}=oracle,{harnessRevision,...metadata}=producer;
    return sha256(JSON.stringify({producer:metadata,...payload}));
  };
  const beforeDigest=digest(before),afterDigest=digest(after);
  return {equal:beforeDigest===afterDigest,beforeDigest,afterDigest};
}

export function compareBkDecisions(oracle,trace,candidate){
  assert.equal(trace.traceVersion,'1.0.0');assert.equal(trace.caseId,oracle.fixture.caseId);
  assert.equal(trace.sourceCommit,oracle.producer.sourceCommit);assert.equal(trace.inputDigest,oracle.fixture.inputDigest);
  const p4Index=oracle.snapshots.findIndex((snapshot)=>snapshot.boundary==='p4');assert.ok(p4Index>0);
  const input=oracle.snapshots[p4Index-1];assert.equal(input.components.length,1);
  const graph=input.components[0],ids=graph.layers.flatMap((layer)=>layer.nodeIds),nodes=new Map(graph.nodes.map((node)=>[node.id,node]));
  const ports=new Map(graph.nodes.flatMap((node)=>node.ports.map((port)=>[port.id,node.id])));
  const edges=new Map(graph.edges.map((edge)=>[edge.id,[ports.get(edge.sourcePortId),edge.sourcePortId,ports.get(edge.targetPortId),edge.targetPortId]]));
  const edgeKeys=new Set([...edges.values()].map((row)=>JSON.stringify(row)));
  const nodeAt=(index)=>{assert.ok(Number.isSafeInteger(index)&&index>=0&&index<ids.length,`unknown BK node index ${index}`);return ids[index];};
  const sourceEdge=(edge)=>{
    if(edge===null)return null;
    const source=nodeAt(edge.sourceIndex),target=nodeAt(edge.targetIndex);
    const sourcePort=nodes.get(source).ports.find((port)=>port.order===edge.sourcePortOrder);
    const targetPort=nodes.get(target).ports.find((port)=>port.order===edge.targetPortOrder);
    assert.ok(sourcePort&&targetPort,'unknown owned-port index');
    const endpoints=[source,sourcePort.id,target,targetPort.id];
    assert.ok(edgeKeys.has(JSON.stringify(endpoints)),'picked edge absent at pre-P4');
    return endpoints;
  };
  const reference=oracle.snapshots[p4Index].phaseData.events.find((event)=>event.event==='bk-candidates');assert.ok(reference);
  const roots=new Map(reference.candidates.map((row)=>[row.direction,new Map(ids.map((id,index)=>[id,nodeAt(Number.parseInt(row.root[index],10))]))]));
  const normalize=(row,source)=>{
    assert.ok(directions.includes(row.direction),`unknown BK direction ${row.direction}`);
    const free=source?nodeAt(row.freeIndex):row.free;
    assert.ok(nodes.has(free),'unknown free node');
    const block=source?nodeAt(row.blockIndex):row.block??roots.get(row.direction).get(free);
    assert.equal(block,roots.get(row.direction).get(free),'invalid decision block owner');
    const edge=source?sourceEdge(row.edge??null):row.edgeId==null?null:edges.get(row.edgeId);
    if(!source&&row.edgeId!=null)assert.ok(edge,`unknown picked edge ${row.edgeId}`);
    const result={event:row.event,free,block};
    switch(row.event){
      case 'threshold-call':
        result.adjacent=source?(row.adjacentIndex===null?null:nodeAt(row.adjacentIndex)):row.adjacent;
        result.previousThreshold=row.previousThreshold;break;
      case 'deferred':result.isRoot=row.isRoot;break;
      case 'bound-pick':case 'post-pick':
        result.isRoot=row.isRoot;result.edge=edge;result.blockY=row.blockY;result.straightened=row.straightened;break;
      case 'move-start':result.edge=edge;result.delta=source?row.amount:row.delta;break;
      case 'move-result':result.edge=edge;result.available=source?row.amount:row.available;result.blockY=row.blockY;break;
      case 'retry':result.isRoot=row.isRoot;result.edge=edge;break;
      case 'finish':result.blockY=row.blockY;break;
      default:throw new Error(`unknown BK event ${row.event}`);
    }
    return result;
  };
  const reports=directions.map((direction)=>{
    const expected=trace.events.filter((row)=>row.direction===direction).map((row)=>normalize(row,true));
    const actual=candidate.report.events.filter((row)=>row.direction===direction).map((row)=>normalize(row,false));
    const requiredRoots=[...new Set(roots.get(direction).values())].sort();
    assert.deepEqual(expected.filter((row)=>row.event==='finish').map((row)=>row.block).sort(),requiredRoots,
      `${direction}: incomplete or duplicate upstream block-finish trace`);
    let first=0;while(first<expected.length&&first<actual.length&&sameEvent(expected[first],actual[first]))first++;
    const firstDifference=first===expected.length&&first===actual.length?null:{index:first,expected:expected[first]??null,actual:actual[first]??null};
    const affected=(candidate.report.candidates.find((row)=>row.direction===direction)?.fields.y.examples??[]).map((row)=>row.id);
    const related=(rows,id)=>rows.filter((row)=>row.free===id||row.block===id||row.edge?.[0]===id||row.edge?.[2]===id);
    const counts=(rows)=>Object.fromEntries([...new Set(rows.map((row)=>row.event))].sort().map((event)=>[event,rows.filter((row)=>row.event===event).length]));
    return {direction,sourceCount:expected.length,candidateCount:actual.length,sourceEventCounts:counts(expected),candidateEventCounts:counts(actual),
      firstDifference,affected:affected.map((id)=>({id,source:related(expected,id),candidate:related(actual,id)}))};
  });
  return {caseId:trace.caseId,coordinateTolerance:BK_DECISION_COORDINATE_TOLERANCE,
    scope:'connected same-pre-P4; edge selection compared by exact owned endpoint identity, not lost parallel-edge insertion IDs',
    allDecisionsMatch:reports.every((row)=>row.firstDifference===null),reports};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [beforeFile,oracleFile,traceFile,candidateFile,output]=process.argv.slice(2);
  if(!output)throw new Error('usage: compare_bk_decisions.mjs <before-oracle> <observed-oracle> <sidecar> <candidate-report> <output.json>');
  const [before,oracle,trace,candidate]=await Promise.all([beforeFile,oracleFile,traceFile,candidateFile].map(async(file)=>JSON.parse(await readFile(file,'utf8'))));
  const observation=compareObservationSnapshots(before,oracle);assert.equal(observation.equal,true,'Java observation changed original snapshots');
  const result={observation,...compareBkDecisions(oracle,trace,candidate)};
  await writeFile(output,JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,reports:result.reports.map(({affected,...row})=>({...row,affectedIds:affected.map((entry)=>entry.id)}))}));
}
