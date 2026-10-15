import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, '../../..');
const manifestPath = path.join(repoRoot, 'tests/fixtures/elk_parity/manifest.json');
const schemaPath = path.join(repoRoot, 'docs/design/elk-native-phase-snapshot.schema.json');
const contractPath = path.join(repoRoot, 'docs/design/elk-native-phase-contracts.md');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
const contract = await readFile(contractPath, 'utf8');

assert.equal(manifest.manifestVersion, '1.0.0');
assert.equal(manifest.snapshotSchemaVersion, schema.properties.schemaVersion.const);
assert.match(manifest.upstream.commit, /^[0-9a-f]{40}$/u);
assert.ok(Array.isArray(manifest.cases) && manifest.cases.length > 0);

const ids = new Set();
const tiers = new Set();
const mechanisms = new Set();

for (const fixtureCase of manifest.cases) {
  assert.match(fixtureCase.id, /^[a-z0-9][a-z0-9_]*$/u);
  assert.ok(!ids.has(fixtureCase.id), `duplicate case id: ${fixtureCase.id}`);
  ids.add(fixtureCase.id);
  tiers.add(fixtureCase.tier);
  assert.ok(Array.isArray(fixtureCase.mechanisms) && fixtureCase.mechanisms.length > 0,
    `${fixtureCase.id} must name mechanisms`);
  fixtureCase.mechanisms.forEach((mechanism) => mechanisms.add(mechanism));
  if (fixtureCase.oracleInput) {
    const inputPath = path.join(repoRoot, fixtureCase.oracleInput);
    const input = JSON.parse(await readFile(inputPath, 'utf8'));
    const tsv = await readFile(inputPath.replace(/\.json$/u, '.tsv'), 'utf8');
    const digest = `sha256:${createHash('sha256').update(tsv.slice(tsv.indexOf('\n') + 1)).digest('hex')}`;
    assert.equal(input.caseId, fixtureCase.id);
    assert.equal(input.inputDigest, digest);
    assert.equal(fixtureCase.inputDigest, digest);
    assert.deepEqual(input.query, fixtureCase.query);
    assert.deepEqual(input.options, { ...manifest.defaults, ...fixtureCase.options });
    const source = await readFile(path.join(repoRoot, fixtureCase.source));
    assert.equal(input.sourceDigest, `sha256:${createHash('sha256').update(source).digest('hex')}`);
  }

  if (fixtureCase.graph) {
    const spec = [
      ...fixtureCase.graph.nodes.map((node) => `${node.id}:${node.width}x${node.height}`),
      ...fixtureCase.graph.edges.map((edge) =>
        `${edge.id}:${edge.source}>${edge.target}:${edge.physicalNet}`)
    ].join('\n');
    const digest = `sha256:${createHash('sha256').update(spec).digest('hex')}`;
    assert.equal(fixtureCase.inputDigest, digest, `${fixtureCase.id} graph digest mismatch`);
    const nodeIds = new Set(fixtureCase.graph.nodes.map((node) => node.id));
    assert.equal(nodeIds.size, fixtureCase.graph.nodes.length, `${fixtureCase.id} duplicate node`);
    const edgeIds = new Set(fixtureCase.graph.edges.map((edge) => edge.id));
    assert.equal(edgeIds.size, fixtureCase.graph.edges.length, `${fixtureCase.id} duplicate edge`);
    for (const edge of fixtureCase.graph.edges) {
      assert.ok(nodeIds.has(edge.source) && nodeIds.has(edge.target),
        `${fixtureCase.id} edge ${edge.id} has missing endpoint`);
    }
  }

  if (fixtureCase.source) {
    const sourcePath = path.join(repoRoot, fixtureCase.source);
    const sourceStat = await stat(sourcePath);
    assert.ok(sourceStat.isFile(), `${fixtureCase.id} source is not a file`);

    if (fixtureCase.stratum) {
      const stratum = manifest.selectionPolicy.mappedSourceSizeStrataBytes
        .find((entry) => entry.name === fixtureCase.stratum);
      assert.ok(stratum, `${fixtureCase.id} has an unknown size stratum`);
      if (stratum.minimumInclusive !== undefined) {
        assert.ok(sourceStat.size >= stratum.minimumInclusive, `${fixtureCase.id} is below its size stratum`);
      }
      if (stratum.maximumInclusive !== undefined) {
        assert.ok(sourceStat.size <= stratum.maximumInclusive, `${fixtureCase.id} is above its size stratum`);
      }
    }
  }
}

assert.deepEqual([...tiers].sort(), ['focused', 'mapped', 'synthetic']);
assert.ok(ids.has('oracle_smoke_001'));
assert.ok(manifest.cases.find((entry) => entry.id === 'oracle_smoke_001').graph);

for (const phasePrefix of ['p1.', 'p2.', 'p3.', 'p4.', 'p5.']) {
  assert.ok([...mechanisms].some((mechanism) => mechanism.startsWith(phasePrefix)),
    `missing ${phasePrefix} mechanism coverage`);
}

for (const heading of ['## P0', '## P1', '## P2', '## P3', '## P4', '## P5']) {
  assert.ok(contract.includes(heading), `contract is missing ${heading}`);
}

console.log(JSON.stringify({
  manifestVersion: manifest.manifestVersion,
  snapshotSchemaVersion: manifest.snapshotSchemaVersion,
  caseCount: manifest.cases.length,
  tiers: [...tiers].sort(),
  mechanismCount: mechanisms.size,
  upstreamCommit: manifest.upstream.commit
}, null, 2));
