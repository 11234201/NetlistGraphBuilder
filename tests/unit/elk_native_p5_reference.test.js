import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadPhaseOracles } from '../helpers/elk_phase_inputs.js';
import { referenceDependencies } from '../reference/elk_native/p5_dependency_reference.js';
import { referenceFeedback } from '../reference/elk_native/p5_feedback_reference.js';
import { feedbackDependencies } from '../../src/layout/elk_native/routing_cycles.js';
import { referenceSplits } from '../reference/elk_native/p5_split_reference.js';
import { splitCriticalCycles } from '../../src/layout/elk_native/routing_split.js';
const corpus = await loadPhaseOracles();
const probe = JSON.parse(await readFile(new URL('../fixtures/elk_parity/oracles/p5_critical_split_001.elk.json', import.meta.url),'utf8'));
const canonical = (dependencies) => dependencies.map((edge) => JSON.stringify(edge)).sort();

test('elk_native critical split tuple and complete reconstruction match independent bounded enumeration',()=>{
  let checkedSplits=0,seed=9173;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  const inputs=[];
  for(const low of [0,10,20])for(const high of [30,40,50])inputs.push([
    {id:'a',...{incoming:[low],outgoing:[high]},start:low,end:high},
    {id:'b',...{incoming:[high],outgoing:[low]},start:low,end:high}]);
  for(let trial=0;trial<192;trial++)inputs.push(Array.from({length:2+random()%5},(_,index)=>{
    const incoming=[...new Set(Array.from({length:1+random()%3},()=>10*(random()%8)))].sort((a,b)=>a-b);
    const outgoing=[...new Set(Array.from({length:1+random()%3},()=>10*(random()%8)))].sort((a,b)=>a-b);
    return {id:`s${index}`,incoming,outgoing,start:Math.min(...incoming,...outgoing),end:Math.max(...incoming,...outgoing)};
  }));
  for(const segments of inputs){
    const dependencies=referenceDependencies(segments,0.2,10);
    const expected=referenceSplits(segments,dependencies,0.2,10);
    if(expected.unresolved){
      assert.throws(()=>splitCriticalCycles(segments,dependencies,0.2,10),/critical-split-did-not-resolve-cycle/);continue;
    }
    const actual=splitCriticalCycles(segments,dependencies,0.2,10);
    assert.deepEqual(actual.splits,expected.splits);
    assert.deepEqual(actual.decisions,expected.decisions);
    assert.deepEqual(actual.segments,expected.segments);
    assert.deepEqual(canonical(actual.dependencies),canonical(expected.dependencies));
    assert.deepEqual(splitCriticalCycles([...segments].reverse(),[...dependencies].reverse(),0.2,10).splits,actual.splits);
    checkedSplits+=actual.splits.length;
  }
  assert.ok(checkedSplits>=9);
});

test('elk_native exact P5 pair reference matches every recorded upstream boundary', () => {
  const events = [...corpus.flatMap((oracle) => oracle.snapshots.find((snapshot) => snapshot.boundary === 'p5').phaseData.events), ...probe.events];
  let checked = 0;
  for (const event of events.filter((event) => event.stage === 'dependencies' || event.stage === 'critical-dependencies')) {
    assert.deepEqual(canonical(referenceDependencies(event.segments,event.criticalThreshold,event.edgeSpacing)),
      canonical(event.dependencies), `boundary ${event.sourceLayerIndex}`);
    checked++;
  }
  assert.ok(checked >= 30);
});

test('elk_native indexed feedback decisions match an independent scan on all small weighted digraphs',()=>{
  const segments=['a','b','c'].map((id)=>({id}));
  const pairs=segments.flatMap(({id:source})=>segments.filter(({id})=>id!==source).map(({id:target})=>({source,target})));
  // Every six-arc graph with each arc absent, zero, unit or weight three.
  for(let encoding=0;encoding<4**pairs.length;encoding++){
    let remaining=encoding;const dependencies=[];
    for(const pair of pairs){const digit=remaining%4;remaining=Math.floor(remaining/4);
      if(digit)dependencies.push({...pair,type:'REGULAR',weight:[0,0,1,3][digit]});}
    const expected=referenceFeedback(segments,dependencies);
    assert.deepEqual(feedbackDependencies(segments,dependencies),expected,`graph ${encoding}`);
    assert.deepEqual(feedbackDependencies([...segments].reverse(),[...dependencies].reverse()),expected);
    const critical=dependencies.map((edge)=>({...edge,type:'CRITICAL'}));
    assert.deepEqual(feedbackDependencies(segments,critical,true),referenceFeedback(segments,critical,true));
  }
});

test('elk_native exact P5 reference preserves strict threshold, zero ties and straight exclusion', () => {
  const pair = [{ id: 'a', start: 0, end: 10, incoming: [0], outgoing: [10] },
    { id: 'b', start: 0, end: 10, incoming: [10], outgoing: [0] }];
  assert.equal(referenceDependencies(pair,0.2,10).filter((edge) => edge.type === 'CRITICAL').length,2);
  assert.equal(referenceDependencies(pair,0,0).filter((edge) => edge.type === 'REGULAR' && edge.weight === 0).length,2);
  assert.deepEqual(referenceDependencies([{ ...pair[0], end: 0.0009 },pair[1]],0.2,10),[]);
});
