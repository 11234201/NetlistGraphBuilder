import test from 'node:test';
import assert from 'node:assert/strict';
import {compareBaselines,collectFileHashes} from '../../tools/research/elk_phase_oracle/quality_baseline.mjs';
import {fileURLToPath} from 'node:url';

test('default quality freeze includes structural fixtures outside the oracle and mapped directories',async()=>{
  const files=await collectFileHashes(fileURLToPath(new URL('../../',import.meta.url)));
  assert.ok(files.some((entry)=>entry.path==='tests/fixtures/tc_unit_generic.v'));
  assert.ok(files.some((entry)=>entry.path==='tests/fixtures/mapped/datapath/dp_020_mapped.v'));
  assert.equal(new Set(files.map((entry)=>entry.path)).size,files.length,'roots must not double-count fixtures');
});

test('quality baseline diff detects additions, removals and edits symmetrically',()=>{
  const left={files:[{path:'same',digest:'s'},{path:'gone',digest:'g'},{path:'changed',digest:'old'}]};
  const right={files:[{path:'new',digest:'n'},{path:'same',digest:'s'},{path:'changed',digest:'new'}]};
  const before=structuredClone({left,right});
  assert.deepEqual(compareBaselines(left,right),[
    {path:'changed',left:'old',right:'new'},{path:'gone',left:'g',right:null},{path:'new',left:null,right:'n'}]);
  assert.deepEqual(compareBaselines(right,left),compareBaselines(left,right).map((entry)=>
    ({path:entry.path,left:entry.right,right:entry.left})));
  assert.deepEqual({left,right},before);
  assert.deepEqual(compareBaselines(left,left),[]);
});
