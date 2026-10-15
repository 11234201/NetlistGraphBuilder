import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadPhaseOracles } from '../helpers/elk_phase_inputs.js';
import { referenceDependencies } from '../reference/elk_native/p5_dependency_reference.js';
import { buildDependencies } from '../../src/layout/elk_native/routing_dependencies.js';
const corpus=await loadPhaseOracles();
const probe=JSON.parse(await readFile(new URL('../fixtures/elk_parity/oracles/p5_critical_split_001.elk.json',import.meta.url),'utf8'));
const canonical=(dependencies)=>dependencies.map((edge)=>JSON.stringify(edge)).sort();

test('elk_native indexed dependency multiset matches every pinned boundary and critical probe',()=>{
  const events=[...corpus.flatMap((oracle)=>oracle.snapshots.find((snapshot)=>snapshot.boundary==='p5').phaseData.events),...probe.events];
  for(const event of events.filter((event)=>['dependencies','critical-dependencies'].includes(event.stage))) {
    const result=buildDependencies(event.segments,event.criticalThreshold,event.edgeSpacing);
    assert.deepEqual(canonical(result.dependencies),canonical(event.dependencies));
    assert.deepEqual(buildDependencies([...event.segments].reverse(),event.criticalThreshold,event.edgeSpacing),result);
  }
});

test('elk_native indexed dependency predicates match bounded exact random hyperedges',()=>{
  let seed=917;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let trial=0;trial<160;trial++) {
    const segments=Array.from({length:2+random()%15},(_,index)=>{
      const incoming=[...new Set(Array.from({length:random()%4},()=>random()%120))].sort((a,b)=>a-b);
      const outgoing=[...new Set(Array.from({length:1+random()%4},()=>random()%120))].sort((a,b)=>a-b);
      return {id:`s${index}`,incoming,outgoing,start:Math.min(...incoming,...outgoing),end:Math.max(...incoming,...outgoing)};
    });
    const critical=trial%4===0?0:0.2*(1+random()%20),spacing=random()%30;
    assert.deepEqual(canonical(buildDependencies(segments,critical,spacing).dependencies),
      canonical(referenceDependencies(segments,critical,spacing)),`trial ${trial}`);
    const focusIds=new Set([segments[0].id]);
    assert.deepEqual(canonical(buildDependencies(segments,critical,spacing,{focusIds}).dependencies),
      canonical(referenceDependencies(segments,critical,spacing).filter((edge)=>focusIds.has(edge.source)||focusIds.has(edge.target))));
  }
});

test('elk_native dependency index skips disjoint unbounded production intervals',()=>{
  const segments=Array.from({length:10000},(_,index)=>({id:`s${index}`,start:index*100,end:index*100+20,
    incoming:[index*100],outgoing:[index*100+20]}));
  const result=buildDependencies(segments,0.2,10);
  assert.equal(result.candidatePairCount,0);
  assert.deepEqual(result.dependencies,[]);
  const controller=new AbortController();controller.abort();
  assert.throws(()=>buildDependencies(segments,0.2,10,{signal:controller.signal}),/cancelled/);
});
