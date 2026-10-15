import assert from 'node:assert/strict';
import test from 'node:test';
import {measureLayerAlignment} from '../../src/layout/elk_native/layer_alignment.js';
import {preparePortGeometry} from '../../src/layout/elk_native/port_geometry.js';
import {forecastOrderGroupBands} from '../../tools/research/elk_phase_oracle/order_group_bands.mjs';

const fixture = () => ({selfLoops: [], options: {nodeNodeBetweenLayers: 40},
  nodes: Array.from({length: 9}, (_, i) => ({id: `n${i}`, width: 20 + i * 3.25,
    margins: {left: i % 3, right: i % 4, top: 0, bottom: 0},
    ports: ['i', 'o'].map((role, index) => ({id: `${i}${role}`, side: index ? 'EAST' : 'WEST',
      x: 0, y: 3, width: 1.5, height: 1, borderOffset: i / 10, anchor: {x: 0, y: 0}}))})),
  layers: [{index: 0, nodeIds: ['n0', 'n1', 'n2']}, {index: 1, nodeIds: ['n3', 'n4', 'n5']},
    {index: 2, nodeIds: ['n6', 'n7', 'n8']}],
  edges: [[0, 3], [0, 4], [0, 4], [1, 5], [3, 6], [4, 6], [4, 7]].map(([a, b]) =>
    ({sourcePortId: `${a}o`, targetPortId: `${b}i`}))});

test('shared alignment preserves measured forecast arithmetic, port incidence and input immutability', () => {
  const input = preparePortGeometry(fixture()), before = structuredClone(input);
  const {layerWidths, offsets} = measureLayerAlignment(input);
  const incoming = new Set(input.edges.map(edge => edge.targetPortId));
  const outgoing = new Set(input.edges.map(edge => edge.sourcePortId));
  for (const [index, layer] of input.layers.entries()) {
    const nodes = layer.nodeIds.map(id => input.nodes.find(node => node.id === id));
    const width = Math.max(0, ...nodes.map(node => node.width + node.margins.left + node.margins.right));
    const left = Math.max(0, ...nodes.map(node => node.margins.left));
    const right = Math.max(0, ...nodes.map(node => node.margins.right));
    assert.equal(layerWidths[index], width);
    for (const node of nodes) {
      const a = node.ports.filter(port => incoming.has(port.id)).length;
      const b = node.ports.filter(port => outgoing.has(port.id)).length;
      const ratio = a + b ? b / (a + b) : 0.5;
      let x = (width - node.width) * ratio;
      if (ratio > 0.5) x -= right * 2 * (ratio - 0.5);
      else if (ratio < 0.5) x += left * 2 * (0.5 - ratio);
      assert.equal(offsets.get(node.id), Math.max(node.margins.left, Math.min(x, width - node.margins.right - node.width)));
    }
  }
  const entries = input.nodes.map(node => ({nodeId: node.id, membershipKey: 'group'}));
  assert.deepEqual(forecastOrderGroupBands(fixture(), entries).offsets,
    [...offsets].toSorted(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const permuted = measureLayerAlignment({...input, nodes: input.nodes.toReversed(), edges: input.edges.toReversed(),
    layers: input.layers.map(layer => ({...layer, nodeIds: layer.nodeIds.toReversed()}))});
  assert.deepEqual(permuted.layerWidths, layerWidths);
  for (const [id, offset] of offsets) assert.equal(permuted.offsets.get(id), offset);
  assert.deepEqual(input, before);
});

test('empty measured layers retain zero width and no offsets', () => {
  assert.deepEqual(measureLayerAlignment({nodes: [], edges: [], layers: [{nodeIds: []}]}),
    {layerWidths: [0], offsets: new Map()});
});
