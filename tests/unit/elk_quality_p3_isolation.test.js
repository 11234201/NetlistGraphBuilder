import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPhaseOracles} from '../helpers/elk_phase_inputs.js';
import {properInputFromOracle,graphInOracleOrder} from '../../tools/research/elk_phase_oracle/upstream_proper_input.mjs';
import {countCrossings} from '../../src/layout/anchor_layered/crossing_counter.js';
import {orderLayers} from '../../src/layout/anchor_layered/p3_ordering.js';
import {mergeHyperedgeDummies} from '../../src/layout/anchor_layered/hyperedge_merge.js';
import {preparePortGeometry} from '../../src/layout/anchor_layered/port_geometry.js';
import {placeNodes} from '../../src/layout/anchor_layered/p4_placement.js';

test('P3 isolation imports exact upstream proper input/ranks/ports/order with complete semantic lineage',async()=>{
  for(const oracle of await loadPhaseOracles()){
    const before=structuredClone(oracle),input=properInputFromOracle(oracle);
    const retained=oracle.snapshots.find((snapshot)=>snapshot.boundary==='p3');
    const expected=retained.phaseData.events.filter((event)=>event.event==='attempt'&&event.retained).at(-1).crossings;
    assert.equal(countCrossings(graphInOracleOrder(input,retained)),expected,oracle.fixture.caseId);
    const inputBefore=structuredClone(input),ordered=orderLayers(input);
    const placed=placeNodes(preparePortGeometry(mergeHyperedgeDummies(ordered)));
    assert.ok(placed.nodes.every((node)=>Number.isFinite(node.y)));
    assert.deepEqual(input,inputBefore);assert.deepEqual(oracle,before);
    assert.equal(Object.isFrozen(oracle.snapshots[0].components[0].nodes[0].margins),false);
    assert.ok(oracle.snapshots.every((snapshot)=>snapshot.components.every((component)=>
      component.nodes.every((node)=>!Object.isFrozen(node.margins)&&node.ports.every((port)=>!Object.isFrozen(port.anchor))))));
  }
});
