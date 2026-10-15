import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {oracleCaseIds} from '../helpers/elk_phase_inputs.js';

const execute=promisify(execFile),script=fileURLToPath(new URL('../../tools/research/elk_phase_oracle/compare_native_phases.mjs',import.meta.url));
test('phase comparison CLI consumes explicit oracle files and never falls back for missing files',async()=>{
  const file=fileURLToPath(new URL('../fixtures/elk_parity/oracles/chain_4.elk.json',import.meta.url));
  const {stdout}=await execute(process.execPath,[script,file]);
  const reports=stdout.trim().split('\n').map(JSON.parse);
  assert.equal(reports.length,1);assert.equal(reports[0].caseId,'chain_4');assert.equal(reports[0].firstDifference,null);
  const defaults=await execute(process.execPath,[script]);
  assert.deepEqual(defaults.stdout.trim().split('\n').map((line)=>JSON.parse(line).caseId),oracleCaseIds);
  await assert.rejects(execute(process.execPath,[script,`${file}.missing`]),(error)=>
    error.code===1&&error.stdout===''&&error.stderr.includes('ENOENT'));
});
