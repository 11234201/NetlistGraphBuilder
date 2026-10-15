import assert from 'node:assert/strict';
import test from 'node:test';
import {SourceRandom,createSourceRandom} from '../../tools/research/elk_phase_oracle/source_random.mjs';
import {compileRandomProbe} from '../../tools/research/elk_phase_oracle/probe_random_ownership.mjs';
import {loadPhaseOracles,inputFromSnapshot} from '../helpers/elk_phase_inputs.js';
import {createCanonicalGraph} from '../../src/layout/elk_native/ir.js';
import {orientGraph} from '../../src/layout/elk_native/p1_orientation.js';
import {assignLayers} from '../../src/layout/elk_native/p2_layering.js';
import {buildProperGraph} from '../../src/layout/elk_native/proper_graph.js';
import {orderLayers} from '../../src/layout/elk_native/p3_ordering.js';
const proper=input=>buildProperGraph(assignLayers(orientGraph(createCanonicalGraph(input))));
test('research Random exactly reproduces direct JDK17 mixed-method vectors and signed derived seed',()=>{
  const generator=new SourceRandom(1),derived=generator.NextLong();
  assert.equal(derived,-4964420948893066024n);assert.equal(generator.NextBoolean(),false);
  generator.SetSeed(derived);
  const expected=[[false,0.8958574803319523,0.9523050785064697,0.12538069486618042],
    [false,0.7285297407169276,0.20729738473892212,0.5244002342224121],
    [false,0.7309382203534593,0.5124011039733887,0.0061432719230651855],
    [false,0.5267414517373605,0.05182945728302002,0.2412356734275818]];
  for(const row of expected)assert.deepEqual([generator.NextBoolean(),generator.NextDouble(),generator.NextFloat(),generator.NextFloat()],row);
  assert.equal(createSourceRandom(1).model,'layer_total');
});
test('random ownership baseline observer is exact; combined is graph-owned and name/permutation independent',async()=>{
  const baseline=await compileRandomProbe(),combined=await compileRandomProbe({sourceRng:true,graphModel:true});
  for(const oracle of await loadPhaseOracles()){
    const input=inputFromSnapshot(oracle.snapshots[0]),before=structuredClone(input),graph=proper(input);
    assert.deepEqual(baseline(graph),orderLayers(graph));
    const result=combined(graph),renamed=proper({...input,nodes:input.nodes.map(node=>({...node,displayName:`display:${node.id}`}))});
    const changed=combined(renamed),reversed=combined(proper({nodes:input.nodes.toReversed().map(node=>({...node,ports:node.ports.toReversed()})),edges:input.edges.toReversed()}));
    assert.deepEqual(changed.layers,result.layers);assert.deepEqual(changed.phaseData,result.phaseData);
    assert.deepEqual(reversed,result);assert.deepEqual(input,before);
    assert.ok(result.phaseData.events.every(event=>event.model==='layer_total'));
  }
});
