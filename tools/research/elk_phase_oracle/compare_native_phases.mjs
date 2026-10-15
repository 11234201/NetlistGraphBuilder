import { createCanonicalGraph } from '../../../src/layout/elk_native/ir.js';
import { orientGraph } from '../../../src/layout/elk_native/p1_orientation.js';
import { assignLayers } from '../../../src/layout/elk_native/p2_layering.js';
import { buildProperGraph } from '../../../src/layout/elk_native/proper_graph.js';
import { orderLayers } from '../../../src/layout/elk_native/p3_ordering.js';
import { loadPhaseOracles, inputFromSnapshot } from '../../../tests/helpers/elk_phase_inputs.js';

const oracleFiles=process.argv.slice(2);
// Explicit files must never silently fall back to the six durable defaults.
const corpus=oracleFiles.length?await Promise.all(oracleFiles.map(async(file)=>JSON.parse(await readFile(file,'utf8')))):
  await loadPhaseOracles();
for (const oracle of corpus) {
  const resolved=oracle.run.resolvedOptions;
  const policy={nodeNodeSpacing:resolved['org.eclipse.elk.spacing.nodeNode'],
    nodeNodeBetweenLayers:resolved['org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers'],
    edgeNodeBetweenLayers:resolved['org.eclipse.elk.layered.spacing.edgeNodeBetweenLayers']};
  const p1 = orientGraph(createCanonicalGraph(inputFromSnapshot(oracle.snapshots[0]),policy));
  const p2 = assignLayers(p1);
  const p3 = orderLayers(buildProperGraph(p2));
  const upstreamP3 = oracle.snapshots.find((snapshot) => snapshot.boundary === 'p3');
  const upstreamCrossings = upstreamP3.phaseData.events.filter((event) => event.event === 'attempt' && event.retained).at(-1).crossings;
  const expectedP1 = oracle.snapshots.find((snapshot) => snapshot.boundary === 'p1');
  const owners = new Map(expectedP1.components.flatMap((component) => component.nodes)
    .flatMap((node) => node.ports.map((port) => [port.id, node.id])));
  const edgeById = new Map(expectedP1.components.flatMap((component) => component.edges)
    .map((edge) => [edge.logicalEdgeId, edge]));
  const orientationDiffs = p1.edges.filter((edge) => {
    const expected = edgeById.get(edge.id);
    return edge.reversed !== expected.reversed || edge.sourceNodeId !== owners.get(expected.sourcePortId)
      || edge.targetNodeId !== owners.get(expected.targetPortId);
  }).map((edge) => edge.id);
  const expectedP2 = oracle.snapshots.find((snapshot) => snapshot.boundary === 'p2');
  const ranks = new Map(expectedP2.components.flatMap((component) => component.nodes)
    .map((node) => [node.id, node.layer]));
  const rankDiffs = p2.nodes.filter((node) => node.layer !== ranks.get(node.id))
    .map((node) => ({ id: node.id, upstream: ranks.get(node.id), native: node.layer }));
  const expectedObjective = oracle.snapshots.flatMap((snapshot) => snapshot.phaseData.events)
    .filter((event) => event.event === 'network-simplex-result')
    .reduce((sum, event) => sum + event.objectiveWeightedSpan, 0);
  const semanticKey=(node)=>node.kind==='long_edge'?JSON.stringify([node.lineage,node.layer,node.box?.height??node.height]):node.id;
  const expectedNodes=new Map(upstreamP3.components.flatMap((component)=>component.nodes).map((node)=>[node.id,node]));
  const nativeNodes=new Map(p3.nodes.map((node)=>[node.id,node]));
  const expectedLayers=upstreamP3.components.flatMap((component)=>component.layers);
  const orderDiffs=p3.layers.flatMap((layer,index)=>{
    const expected=expectedLayers[index]?.nodeIds.map((id)=>semanticKey(expectedNodes.get(id)))??[];
    const actual=layer.nodeIds.map((id)=>semanticKey(nativeNodes.get(id)));
    return JSON.stringify(expected)===JSON.stringify(actual)?[]:[{layer:index,expected,actual}];
  });
  console.log(JSON.stringify({ caseId: oracle.fixture.caseId,
    firstDifference: orientationDiffs.length ? 'p1' : rankDiffs.length ? 'p2-rank-tie' : orderDiffs.length?'p3-order':null,
    orientationDiffs, upstreamObjective: expectedObjective,
    nativeObjective: p2.phaseData.objectiveWeightedSpan,
    upstreamLayers: expectedP2.metrics.layerCount, nativeLayers: p2.layers.length,
    pivots: p2.phaseData.components.reduce((sum, component) => sum + component.pivots.length, 0), rankDiffs,
    upstreamCrossings, nativeCrossings: p3.phaseData.crossings,orderDiffs,policy:p3.options,
    attempts: p3.phaseData.events.filter((event) => event.event === 'attempt').map((event) => event.crossings) }));
}
import {readFile} from 'node:fs/promises';
