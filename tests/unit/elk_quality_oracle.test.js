import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateCapturedOracle} from '../../tools/research/elk_phase_oracle/validate_captured_oracle.mjs';

test('captured-oracle validation preserves explicit input, lineage and every processor-boundary invariant',async()=>{
  const read=(file)=>readFile(new URL(`../fixtures/elk_parity/${file}`,import.meta.url),'utf8').then(JSON.parse);
  const oracle=await read('oracles/sop015_5426_focused_3_3.elk.json');
  const input=await read('inputs/sop015_5426_focused_3_3.json');
  const before=structuredClone({oracle,input});
  const result=validateCapturedOracle(oracle,input);
  assert.equal(result.implicitPortCount,0);assert.ok(result.boundaries.some((item)=>item.boundary==='p4'));
  assert.deepEqual({oracle,input},before);
  const bad=structuredClone(oracle);bad.snapshots[0].components[0].edges[0].physicalNetId='wrong';
  assert.throws(()=>validateCapturedOracle(bad,input));
});
