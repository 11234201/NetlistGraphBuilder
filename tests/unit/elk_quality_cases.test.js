import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {canonicalFromSpec,materializeSyntheticCase} from '../helpers/elk_quality_cases.js';
import {createCanonicalGraph} from '../../src/layout/elk_native/ir.js';
import {inventoryCases} from '../../tools/research/elk_phase_oracle/quality_baseline.mjs';
const manifest=JSON.parse(await readFile(new URL('../fixtures/elk_parity/manifest.json',import.meta.url),'utf8'));

test('quality corpus materializes every declared synthetic graph without changing the manifest',()=>{
  const before=structuredClone(manifest);
  for(const entry of manifest.cases.filter((entry)=>entry.tier==='synthetic')){
    const first=materializeSyntheticCase(entry);
    if(entry.mechanismProbe){assert.equal(first,null);continue;}
    assert.deepEqual(materializeSyntheticCase(entry),first);
    assert.ok(first.input.nodes.length>0);createCanonicalGraph(first.input);
    if(entry.generator?.kind==='tree')assert.equal(first.input.nodes.length,15);
    if(entry.generator?.kind==='cycle_with_self_loop')assert.equal(first.input.edges.filter((edge)=>
      edge.sourcePortId.split('::')[0]===edge.targetPortId.split('::')[0]).length,1);
  }
  assert.deepEqual(manifest,before);
});
test('quality synthetic port generation is stable under input array permutations and shares fanout ports',()=>{
  const spec={nodes:[{id:'a',width:40,height:30},{id:'b',width:40,height:30},{id:'c',width:40,height:30}],
    edges:[{id:'ab',source:'a',target:'b',physicalNet:'fan'},{id:'ac',source:'a',target:'c',physicalNet:'fan'}]};
  const forward=canonicalFromSpec(spec);
  assert.deepEqual(canonicalFromSpec({nodes:spec.nodes.toReversed(),edges:spec.edges.toReversed()}),forward);
  assert.equal(forward.edges[0].sourcePortId,forward.edges[1].sourcePortId);
});
test('quality inventory separates complete phase snapshots from a mechanism probe and unrun declarations',async()=>{
  const inventory=await inventoryCases(fileURLToPath(new URL('../../',import.meta.url)));
  assert.equal(inventory.cases.length,18);
  assert.equal(inventory.cases.filter((entry)=>entry.completeUpstreamPhases).length,6);
  assert.equal(inventory.cases.find((entry)=>entry.id==='p5_critical_split_001').completeUpstreamPhases,false);
  assert.ok(inventory.cases.every((entry)=>entry.currentRunStatus==='not-run'));
});
