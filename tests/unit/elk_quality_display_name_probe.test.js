import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPhaseOracles,inputFromSnapshot} from '../helpers/elk_phase_inputs.js';
import {probeDisplayNameOrdering} from '../../tools/research/elk_phase_oracle/probe_display_name_ordering.mjs';

test('display-name diagnostic changes only metadata and reports reproducible first ordering divergence',async()=>{
  for(const oracle of await loadPhaseOracles()){
    const input=inputFromSnapshot(oracle.snapshots[0]),before=structuredClone(input);
    const report=probeDisplayNameOrdering(input);
    assert.equal(report.reports[0].semanticDigest,report.reports[1].semanticDigest);
    assert.equal(report.firstDivergentPhase,report.changedLayers.length?'p3':null);
    assert.deepEqual(probeDisplayNameOrdering({...input,nodes:input.nodes.toReversed(),edges:input.edges.toReversed()}),report);
    assert.deepEqual(input,before);
    assert.equal(Object.isFrozen(input.nodes[0].ports),false);
  }
});
