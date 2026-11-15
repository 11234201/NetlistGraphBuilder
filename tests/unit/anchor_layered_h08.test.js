import assert from 'node:assert/strict';
import test from 'node:test';
import {layoutGraph} from '../../src/layout/anchor_layered/index.js';
import {normalizeH08Profile} from '../../src/layout/anchor_layered/h08_profile.js';
import {normalizeAnchorProfile} from '../../src/layout/anchor_layered/anchor_profile.js';
import {NativeLayeredLayoutProvider} from '../../src/layout/anchor_layout_provider.js';
import {layoutGraph as fixedH08} from '../../src/layout/anchor_layered/h08.js';

// Algorithm, permutation, cancellation and research-oracle coverage belongs to
// anchor_layered_anchor.test.js. H08 retains only its compatibility contract.
test('legacy H08 entry, profile and provider preserve AnchorLayered geometry', async () => {
  const input = {nodes: ['a', 'r'].map(id => ({id, width: 40, height: 30, ports: [
    {id: `${id}:i`, side: 'WEST', x: 0, y: 10},
    {id: `${id}:o`, side: 'EAST', x: 40, y: 10}
  ]})), edges: [{id: 'ar', sourcePortId: 'a:o', targetPortId: 'r:i', physicalNetId: 'n'}]};
  const groups = [{nodeId: 'a', membershipKey: 'tree'}];
  const expected = await layoutGraph(input, {profile: 'anchor', orderGroups: groups});
  const legacy = await fixedH08(input, {profile: 'baseline', orderGroups: groups});
  const profile = normalizeH08Profile(input, groups);
  assert.equal(profile.id, 'h08');
  assert.equal(profile.version, '1.0.0');
  assert.deepEqual(profile, normalizeAnchorProfile(input, groups, 'h08'));
  assert.deepEqual(legacy.phaseData.profile, profile);
  assert.deepEqual(legacy, {...expected, phaseData: {...expected.phaseData, profile}});
  assert.deepEqual(await layoutGraph(input, {profile: 'h08', orderGroups: groups}), legacy);

  const graph = {nodes: [
    {id: 'a', kind: 'input', label: 'a'},
    {id: 'r', kind: 'output', label: 'r'}
  ], edges: [{id: 'ar', source: 'a', target: 'r', net: 'n'}]};
  const legacyGraph = await new NativeLayeredLayoutProvider({profile: 'h08'}).layout(graph);
  const anchorGraph = await new NativeLayeredLayoutProvider({profile: 'anchor'}).layout(graph);
  assert.equal(legacyGraph.layoutMetrics.profile.id, 'h08');
  const {id, digest, ...legacyPolicy} = legacyGraph.layoutMetrics.profile;
  const {id: anchorId, digest: anchorDigest, ...anchorPolicy} = anchorGraph.layoutMetrics.profile;
  assert.equal(anchorId, 'anchor');
  assert.notEqual(digest, anchorDigest);
  assert.deepEqual(legacyPolicy, anchorPolicy);
  assert.deepEqual(legacyGraph, {...anchorGraph, layoutMetrics: {
    ...anchorGraph.layoutMetrics, profile: legacyGraph.layoutMetrics.profile
  }});
});
