import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanonicalGraph } from '../../src/layout/elk_native/ir.js';
import { orientGraph } from '../../src/layout/elk_native/p1_orientation.js';
import { assignLayers } from '../../src/layout/elk_native/p2_layering.js';
import { validateP2 } from '../../src/layout/elk_native/validate_p2.js';
import { exhaustiveRankObjective } from '../reference/elk_native/rank_reference.js';
import { loadPhaseOracles, inputFromSnapshot } from '../helpers/elk_phase_inputs.js';
const corpus = await loadPhaseOracles();

const run = (input, policy) => assignLayers(orientGraph(createCanonicalGraph(input, policy)));

test('elk_native simplex iteration exhaustion retains feasible ranks without claiming optimality',()=>{
  let state=1947,exhausted=0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
  for(let trial=0;trial<8;trial++){
    const links=[];
    for(let source=0;source<80;source++)for(let target=source+1;target<80;target++)
      if(random()<0.075)links.push([source,target]);
    const result=run(dag(80,links),{thoroughness:1});
    validateP2(result);
    for(const diagnostic of result.phaseData.components.filter((component)=>!component.optimal)){
      assert.equal(diagnostic.termination,'iteration-limit');
      assert.equal(diagnostic.pivotCount,diagnostic.iterationLimit);
      assert.ok(diagnostic.negativeCutCount>0);
      assert.ok(diagnostic.zeroShiftCount<=diagnostic.pivotCount);
      assert.ok(diagnostic.pivots.at(-1).leaveEdgeId);
      exhausted++;
    }
  }
  assert.ok(exhausted>0,'bounded sample must exercise iteration exhaustion');
});
function dag(count, links) {
  const nodes = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, width: 40, height: 30,
    ports: [{ id: `n${i}:in`, side: 'WEST', x: 0, y: 15 },
      { id: `n${i}:out`, side: 'EAST', x: 40, y: 15 }] }));
  const edges = links.map(([source, target, weight = 1], i) => ({ id: `e${i}`, physicalNetId: `net${i}`,
    sourcePortId: `n${source}:out`, targetPortId: `n${target}:in`, weight }));
  return { nodes, edges };
}

test('elk_native simplex objective matches six pinned upstream P2 results', () => {
  for (const oracle of corpus) {
    const result = run(inputFromSnapshot(oracle.snapshots[0]));
    const expected = oracle.snapshots.flatMap((snapshot) => snapshot.phaseData.events)
      .find((event) => event.event === 'network-simplex-result');
    assert.equal(result.phaseData.objectiveWeightedSpan, expected.objectiveWeightedSpan, oracle.fixture.caseId);
    assert.equal(result.phaseData.optimal,true);
    const upstream = oracle.snapshots.find((snapshot) => snapshot.boundary === 'p2');
    assert.equal(result.layers.length, upstream.metrics.layerCount, oracle.fixture.caseId);
    const ranks = new Map(upstream.components.flatMap((component) => component.nodes)
      .map((node) => [node.id, node.layer]));
    for (const node of result.nodes) assert.equal(node.layer, ranks.get(node.id), node.id);
    validateP2(result);
  }
});

test('elk_native simplex matches independent enumeration on every four-node forward DAG', () => {
  const pairs = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
  for (let mask = 0; mask < 64; mask++) {
    const graph = orientGraph(createCanonicalGraph(dag(4, pairs.filter((_, i) => mask & (1 << i)))));
    const result = assignLayers(graph);
    const optimum = exhaustiveRankObjective(graph.nodes.map((node) => node.id), graph.edges);
    assert.equal(result.phaseData.objectiveWeightedSpan, optimum, `edge mask ${mask}`);
  }
});

test('elk_native simplex matches weighted small DAG enumeration and preserves optimal balancing', () => {
  let randomState = 2317;
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState; };
  for (let trial = 0; trial < 32; trial++) {
    const links = [];
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
      if (random() % 3) links.push([i, j, 1 + random() % 5]);
    }
    const graph = orientGraph(createCanonicalGraph(dag(5, links)));
    const result = assignLayers(graph);
    assert.equal(result.phaseData.objectiveWeightedSpan,
      exhaustiveRankObjective(graph.nodes.map((node) => node.id), graph.edges), `trial ${trial}`);
  }
});

test('elk_native simplex is permutation-stable with identical tree, cut and pivot evidence', () => {
  for (const oracle of corpus) {
    const input = inputFromSnapshot(oracle.snapshots[0]);
    assert.deepEqual(run({ nodes: [...input.nodes].reverse(), edges: [...input.edges].reverse() }), run(input),
      oracle.fixture.caseId);
  }
});

test('elk_native subtree peeling reattaches every rank in a large tree', () => {
  const input = dag(80, Array.from({ length: 79 }, (_, i) => [i, i + 1]));
  const result = run(input);
  assert.equal(result.phaseData.components[0].peeledNodeIds.length, 79);
  assert.equal(result.phaseData.objectiveWeightedSpan, 79);
  assert.equal(result.layers.length, 80);
  assert.deepEqual(result.nodes.map((node) => node.layer), result.nodes.map((node) => Number(node.id.slice(1))));
});

test('elk_native simplex keeps disconnected components and longer minimum spans feasible', () => {
  const input = dag(5, [[0,1],[1,2],[3,4]]);
  input.edges[0].minimumLength = 2;
  const result = run(input);
  assert.equal(result.phaseData.components.length, 2);
  assert.equal(result.phaseData.objectiveWeightedSpan, 4);
  assert.equal(result.nodes.find((node) => node.id === 'n2').layer, 3);
  validateP2(result);
});
