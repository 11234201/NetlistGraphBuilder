import { readFile } from 'node:fs/promises';
import { createCanonicalGraph } from '../../src/layout/elk_native/ir.js';
import { orientGraph } from '../../src/layout/elk_native/p1_orientation.js';
import { assignLayers } from '../../src/layout/elk_native/p2_layering.js';
import { buildProperGraph } from '../../src/layout/elk_native/proper_graph.js';

export const oracleCaseIds = ['oracle_smoke_001', 'chain_4', 'diamond', 'reconvergent_long_edge',
  'multi_port_fanout_hyperedge', 'sop015_5426_focused_3_3'];

export async function loadPhaseOracles() {
  return Promise.all(oracleCaseIds.map(async (id) => JSON.parse(await readFile(
    new URL(`../fixtures/elk_parity/oracles/${id}.elk.json`, import.meta.url), 'utf8'))));
}

export function inputFromSnapshot(snapshot) {
  return { nodes: snapshot.components.flatMap((component) => component.nodes).map((node) => ({
    id: node.id, width: node.box.width, height: node.box.height,
    ports: node.ports.map((port) => ({ id: port.id, side: port.side,
      x: port.box.x, y: port.box.y, width: port.box.width, height: port.box.height, anchor: port.anchor }))
  })), edges: snapshot.components.flatMap((component) => component.edges).map((edge) => ({
    id: edge.logicalEdgeId, physicalNetId: edge.physicalNetId,
    sourcePortId: edge.sourcePortId, targetPortId: edge.targetPortId
  })) };
}

// Isolate a downstream phase from upstream tie-breaking: only topology identities
// come from our proper graph; the recorded preceding boundary supplies order/y.
export function graphFromP4Oracle(oracle) {
  const resolved=oracle.run.resolvedOptions;
  const graph=buildProperGraph(assignLayers(orientGraph(createCanonicalGraph(inputFromSnapshot(oracle.snapshots[0]),{
    nodeNodeSpacing:resolved['org.eclipse.elk.spacing.nodeNode'],
    nodeNodeBetweenLayers:resolved['org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers'],
    edgeNodeBetweenLayers:resolved['org.eclipse.elk.layered.spacing.edgeNodeBetweenLayers']
  }))));
  const snapshot=oracle.snapshots.find((entry)=>entry.boundary==='p4');
  const source=snapshot.components.flatMap((component)=>component.nodes);
  const key=(node,raw=false)=>node.kind==='long_edge'
    ?JSON.stringify([node.lineage,node.layer,raw?node.box.height:node.height]):node.id;
  const byKey=new Map(graph.nodes.map((node)=>[key(node),node]));
  const mapping=new Map(source.map((node)=>[node.id,byKey.get(key(node,true)).id]));
  return {...graph,phase:'p4',nodes:source.map((node)=>({...byKey.get(key(node,true)),
    y:node.box.y,order:node.order,margins:node.margins})),layers:graph.layers.map((layer)=>({
    ...layer,nodeIds:source.filter((node)=>node.layer===layer.index).sort((a,b)=>a.order-b.order).map((node)=>mapping.get(node.id))}))};
}
