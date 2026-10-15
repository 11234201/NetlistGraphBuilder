import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanonicalGraph} from '../../src/layout/elk_native/ir.js';
import {orientGraph} from '../../src/layout/elk_native/p1_orientation.js';
import {assignLayers} from '../../src/layout/elk_native/p2_layering.js';
import {buildProperGraph} from '../../src/layout/elk_native/proper_graph.js';
import {crossingContext,countCrossings} from '../../src/layout/elk_native/crossing_counter.js';
import {crossingContext as oldContext,countCrossings as oldCount} from '../reference/elk_native/crossing_counter_baseline.js';
import {loadPhaseOracles,inputFromSnapshot} from '../helpers/elk_phase_inputs.js';
const corpus=await loadPhaseOracles();

test('cached hyperedge topology preserves complete counter scores across pinned order permutations',()=>{
  for(const oracle of corpus){
    const graph=buildProperGraph(assignLayers(orientGraph(createCanonicalGraph(inputFromSnapshot(oracle.snapshots[0])))));
    const context=crossingContext(graph);
    assert.deepEqual(context,oldContext(graph));
    for(let trial=0;trial<16;trial++){
      const layers=graph.layers.map(({nodeIds})=>{
        const offset=trial%Math.max(1,nodeIds.length),rotated=[...nodeIds.slice(offset),...nodeIds.slice(0,offset)];
        return trial%2?rotated.reverse():rotated;
      });
      assert.equal(countCrossings(graph,layers,context),oldCount(graph,layers,context));
    }
  }
});

function square(frozen=true){
  const nodes=['l0','l1','r0','r1'].map((id)=>({id,layer:id[0]==='l'?0:1,
    ports:[{id:`p${id}`,side:id[0]==='l'?'EAST':'WEST'}]}));
  const edge=(id,source,target)=>({id,sourceNodeId:source,targetNodeId:target,
    sourcePortId:`p${source}`,targetPortId:`p${target}`,segmentKind:'inter_layer'});
  const edges=[edge('e0','l0','r1'),edge('e1','l1','r0')].map((item)=>frozen?Object.freeze(item):item);
  return {nodes,edges,layers:[{nodeIds:['l0','l1']},{nodeIds:['r0','r1']}],edge};
}
test('crossing topology cache rebuilds for length, array identity and same-length member replacement',()=>{
  const graph=square(),context=crossingContext(graph);
  assert.equal(countCrossings(graph,undefined,context),1);
  context.boundaries[0].push(Object.freeze(graph.edge('join','l0','r0')));
  assert.equal(countCrossings(graph,undefined,context),0);
  assert.equal(countCrossings(graph,undefined,context),oldCount(graph,undefined,context));
  context.boundaries[0]=[...graph.edges];
  assert.equal(countCrossings(graph,undefined,context),1);
  const next=crossingContext(graph);
  next.boundaries[0][0]=Object.freeze(graph.edge('replace','l0','r0'));
  assert.equal(countCrossings(graph,undefined,next),0);
  assert.equal(countCrossings(graph,undefined,next),oldCount(graph,undefined,next));
});
test('mutable edge contexts retain uncached endpoint-update behavior',()=>{
  const graph=square(false),context=crossingContext(graph);
  assert.equal(countCrossings(graph,undefined,context),1);
  graph.edges[0].targetNodeId='r0';graph.edges[0].targetPortId='pr0';
  assert.equal(countCrossings(graph,undefined,context),0);
  assert.equal(countCrossings(graph,undefined,context),oldCount(graph,undefined,context));
});
test('frozen accessor records do not claim immutable endpoint topology',()=>{
  const graph=square();let target='r1';
  graph.edges[0]=Object.freeze({...graph.edges[0],get targetNodeId(){return target;},get targetPortId(){return `p${target}`;}});
  const context=crossingContext(graph);
  assert.equal(countCrossings(graph,undefined,context),1);
  target='r0';
  assert.equal(countCrossings(graph,undefined,context),0);
  assert.equal(countCrossings(graph,undefined,context),oldCount(graph,undefined,context));
});
