import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import * as sweep from '../../src/layout/elk_native/group_sweep.js';
import * as candidates from '../../src/layout/elk_native/order_group_candidates.js';
import {forecastOrderGroupBands} from '../../src/layout/elk_native/order_group_bands.js';
import {scoreOrderGroups} from '../../src/layout/elk_native/order_group_score.js';
import {splitImplicitEndpoints} from '../../src/layout/elk_native/implicit_endpoints.js';
import * as researchSweep from '../../tools/research/elk_phase_oracle/group_sweep.mjs';
import * as researchCandidates from '../../tools/research/elk_phase_oracle/order_group_candidates.mjs';
import {forecastOrderGroupBands as researchBands} from '../../tools/research/elk_phase_oracle/order_group_bands.mjs';
import {scoreOrderGroups as researchScore} from '../../tools/research/elk_phase_oracle/order_group_score.mjs';
import {splitImplicitEndpoints as researchEndpoints} from '../../tools/research/elk_phase_oracle/probe_alias_key.mjs';

test('static group and implicit endpoint modules are the unique research implementations', () => {
  for (const name of ['createGroupSweepContext', 'cohereBandIds', 'cohereLayoutUnits'])
    assert.equal(researchSweep[name], sweep[name]);
  for (const name of ['buildOrderGroupCandidates', 'selectOrderGroupCandidate'])
    assert.equal(researchCandidates[name], candidates[name]);
  assert.equal(researchBands, forecastOrderGroupBands);
  assert.equal(researchScore, scoreOrderGroups);
  assert.equal(researchEndpoints, splitImplicitEndpoints);
});

test('static group and endpoint failures retain owning phase diagnostics', () => {
  assert.throws(() => scoreOrderGroups([{index: 0, nodeIds: ['a', 'a']}], []), error =>
    error.diagnostic?.phase === 'p3' && /duplicate ordered node/.test(error.diagnostic.detail));
  const graph = {nodes: [{id: 'a', ports: []}], edges: [{id: 'edge', sourcePortId: 'missing'}]};
  const before = structuredClone(graph);
  assert.throws(() => splitImplicitEndpoints(graph), error =>
    error.diagnostic?.phase === 'adapter' && error.diagnostic.invariant === 'missing-endpoint-port');
  assert.deepEqual(graph, before);
});

test('static group mechanism dependency closure uses only offline relative JavaScript modules', async () => {
  const seen = new Set();
  const inspect = async url => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const source = await readFile(url, 'utf8');
    assert.doesNotMatch(source, /\b(?:eval|new Function)\s*\(|\bBuffer\b|data:text\/javascript/);
    for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
      assert.match(match[1], /^\.\.?\/.+\.js$/);
      await inspect(new URL(match[1], url));
    }
  };
  for (const name of ['group_sweep', 'order_group_candidates', 'implicit_endpoints', 'h08'])
    await inspect(new URL(`../../src/layout/elk_native/${name}.js`, import.meta.url));
  assert.ok(seen.size > 10);
});
