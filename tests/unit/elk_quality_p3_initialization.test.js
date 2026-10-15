import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPhaseOracles} from '../helpers/elk_phase_inputs.js';
import {initializationVariants} from '../../tools/research/elk_phase_oracle/p3_initialization.mjs';
import {properInputFromOracle} from '../../tools/research/elk_phase_oracle/upstream_proper_input.mjs';
test('P3 initialization controls preserve identity, seed and exact full observed input',async()=>{
  for(const oracle of await loadPhaseOracles()){
    const before=structuredClone(oracle),variants=initializationVariants(oracle),observed=properInputFromOracle(oracle);
    assert.equal(variants.length,8);
    assert.deepEqual(variants[7].graph.nodes,observed.nodes);
    assert.deepEqual(variants[7].graph.layers,observed.layers);
    for(const {graph} of variants){
      assert.equal(graph.inputDigest,observed.inputDigest);
      assert.deepEqual(graph.edges,observed.edges);
      assert.deepEqual(graph.nodes.map(node=>node.id),observed.nodes.map(node=>node.id));
    }
    assert.deepEqual(oracle,before);
    const normal=initializationVariants(oracle,{portScope:'normal'})[2].graph;
    const dummy=initializationVariants(oracle,{portScope:'dummy'})[2].graph;
    for(const node of variants[0].graph.nodes){
      const unchanged=(node.kind==='long_edge'?normal:dummy).nodes.find(entry=>entry.id===node.id);
      assert.deepEqual(unchanged.ports,node.ports);
    }
    assert.deepEqual(oracle,before);
  }
});
