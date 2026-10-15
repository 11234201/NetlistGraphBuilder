import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPhaseOracles} from '../helpers/elk_phase_inputs.js';
import {probeBkFromOracle} from '../../tools/research/elk_phase_oracle/probe_bk_from_oracle.mjs';

test('raw pre-P4 upstream probe isolates all four BK candidates without native ranking/order assumptions',async()=>{
  for(const oracle of await loadPhaseOracles()){
    const before=structuredClone(oracle);
    const result=probeBkFromOracle(oracle);
    assert.equal(result.matches,true,`${oracle.fixture.caseId}: ${JSON.stringify(result.candidates)}`);
    assert.deepEqual(oracle,before);
  }
});
