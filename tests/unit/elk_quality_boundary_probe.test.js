import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPhaseOracles} from '../helpers/elk_phase_inputs.js';
import {probeBkFromOracle} from '../../tools/research/elk_phase_oracle/probe_bk_from_oracle.mjs';
import {compileBoundaryProbe} from '../../tools/research/elk_phase_oracle/probe_bk_boundary_threshold.mjs';

test('threshold research observer preserves original BK and input snapshots on all four candidates',async()=>{
  for(const oracle of await loadPhaseOracles()){
    const before=structuredClone(oracle),events=[];
    const compactor=await compileBoundaryProbe({events});
    assert.deepEqual(probeBkFromOracle(oracle,{compactor}),probeBkFromOracle(oracle));
    assert.ok(events.some((event)=>event.event==='threshold-call'&&event.adjacent===null));
    assert.deepEqual(oracle,before);
  }
});
