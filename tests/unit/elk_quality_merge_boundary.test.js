import assert from 'node:assert/strict';
import test from 'node:test';
import {loadPhaseOracles} from '../helpers/elk_phase_inputs.js';
import {probeMergeBoundary} from '../../tools/research/elk_phase_oracle/probe_merge_boundary.mjs';
test('scheduled merge boundaries match exactly; unscheduled boundaries are rejected rather than fabricated',async()=>{
  for(const oracle of await loadPhaseOracles()){
    const before=structuredClone(oracle);
    if(!oracle.snapshots.some(snapshot=>snapshot.processor.className?.endsWith('HyperedgeDummyMerger'))){
      assert.throws(()=>probeMergeBoundary(oracle),/merge boundary absent/);
      assert.deepEqual(oracle,before);continue;
    }
    const report=probeMergeBoundary(oracle);
    assert.deepEqual(report.native,report.source,oracle.fixture.caseId);
    assert.deepEqual(oracle,before);
  }
});
