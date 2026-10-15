import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, '../../..');
const manifest = JSON.parse(await readFile(path.join(repoRoot,
  'tests/fixtures/elk_parity/manifest.json'), 'utf8'));
const probe = JSON.parse(await readFile(path.join(repoRoot,
  'tests/fixtures/elk_parity/oracles/p5_critical_split_001.elk.json'), 'utf8'));
const fixture = manifest.cases.find((entry) => entry.id === probe.fixture);

assert.equal(probe.probeVersion, '1.0.0');
assert.equal(probe.sourceCommit, manifest.upstream.commit);
assert.ok(fixture);
assert.equal(fixture.mechanismProbe.kind, 'orthogonal_segment_conflict');
assert.equal(probe.seed, fixture.mechanismProbe.seed);
for (const key of ['firstIncoming', 'firstOutgoing', 'secondIncoming', 'secondOutgoing',
  'criticalThreshold', 'edgeSpacing']) {
  assert.deepEqual(probe.input[key], fixture.mechanismProbe[key], key);
}
assert.deepEqual(probe.events.map((event) => event.event),
  ['boundary-state', 'dependency-decision', 'segment-split', 'boundary-state']);
const [before, decision, split, after] = probe.events;
assert.equal(before.stage, 'critical-dependencies');
assert.equal(before.segments.length, 2);
assert.equal(before.dependencies.length, 2);
assert.ok(before.dependencies.every((dependency) => dependency.type === 'CRITICAL'));
assert.equal(decision.action, 'critical-cycle');
assert.equal(split.position, 5);
assert.equal(after.stage, 'after-split');
assert.equal(after.segments.length, 3);
assert.ok(after.segments.some((segment) => segment.splitPartner !== null));

console.log(JSON.stringify({
  caseId: probe.fixture,
  criticalDependencies: before.dependencies.length,
  splitPosition: split.position,
  segmentsAfterSplit: after.segments.length
}, null, 2));
