import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadPhaseOracles } from '../helpers/elk_phase_inputs.js';
import { feedbackDependencies,removeRegularCycles } from '../../src/layout/elk_native/routing_cycles.js';
import { splitCriticalCycles } from '../../src/layout/elk_native/routing_split.js';
import { assignRoutingSlots } from '../../src/layout/elk_native/routing_slots.js';
const corpus=await loadPhaseOracles();
const probe=JSON.parse(await readFile(new URL('../fixtures/elk_parity/oracles/p5_critical_split_001.elk.json',import.meta.url),'utf8'));

test('elk_native slots match all pinned acyclic boundary graphs including rightward compaction',()=>{
  for(const oracle of corpus) {
    const events=oracle.snapshots.find((snapshot)=>snapshot.boundary==='p5').phaseData.events;
    for(const event of events.filter((event)=>event.stage==='acyclic')) {
      const result=assignRoutingSlots(event.segments,event.dependencies);
      const expected=events.find((entry)=>entry.stage==='slotted'&&entry.sourceLayerIndex===event.sourceLayerIndex);
      for(const segment of expected.segments)assert.equal(result.slots.get(segment.id),segment.routingSlot,
        `${oracle.fixture.caseId}/${event.sourceLayerIndex}/${segment.id}`);
    }
  }
});

test('elk_native critical cycle splitter matches pinned exact probe split/dependencies',()=>{
  const initial=probe.events.find((event)=>event.stage==='critical-dependencies');
  const result=splitCriticalCycles(initial.segments,initial.dependencies,initial.criticalThreshold,initial.edgeSpacing);
  assert.deepEqual(result.decisions,probe.events.filter((event)=>event.event==='dependency-decision')
    .map(({action,dependency})=>({action,dependency})));
  const expectedSplit=probe.events.find((event)=>event.event==='segment-split');
  assert.equal(result.splits[0].segment,expectedSplit.segment);assert.equal(result.splits[0].position,expectedSplit.position);
  const expected=probe.events.find((event)=>event.stage==='after-split');
  const normalize=(id)=>id.startsWith('split:')?'segment:2':id;
  const dependencies=result.dependencies.map((edge)=>({...edge,source:normalize(edge.source),target:normalize(edge.target)}));
  assert.deepEqual(dependencies.map((edge)=>JSON.stringify(edge)).sort(),expected.dependencies.map((edge)=>JSON.stringify(edge)).sort());
  for(const segment of result.segments) {
    const match=expected.segments.find((entry)=>entry.id===normalize(segment.id));
    assert.deepEqual(segment.incoming,match.incoming);assert.deepEqual(segment.outgoing,match.outgoing);
  }
  assignRoutingSlots(result.segments,result.dependencies);
});

test('elk_native regular feedback preserves critical arcs and terminates deterministically',()=>{
  const segments=['a','b','c','d'].map((id)=>({id,incoming:[0],outgoing:[10]}));
  const dependencies=[{source:'a',target:'b',type:'CRITICAL',weight:1},
    {source:'b',target:'c',type:'REGULAR',weight:3},{source:'c',target:'a',type:'REGULAR',weight:1},
    {source:'c',target:'d',type:'REGULAR',weight:0},{source:'d',target:'c',type:'REGULAR',weight:0}];
  const result=removeRegularCycles(segments,dependencies);
  assert.deepEqual(result,removeRegularCycles([...segments].reverse(),[...dependencies].reverse()));
  assert.ok(result.dependencies.some((edge)=>edge.source==='a'&&edge.target==='b'&&edge.type==='CRITICAL'));
  // Weighted Eades may discard an acyclic zero-weight preference; topological
  // numbering, not a second heuristic run, is the authoritative DAG proof.
  const slots=assignRoutingSlots(segments,result.dependencies).slots;
  for(const edge of result.dependencies)assert.ok(slots.get(edge.target)>slots.get(edge.source));
});
