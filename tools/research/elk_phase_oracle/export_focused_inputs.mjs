import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModuleWorkspace } from '../../../src/app/moduleWorkspace.js';
import { ElkLayoutProvider } from '../../../src/layout/elkLayoutProvider.js';
import { parseVerilog } from '../../../src/parser/verilogParser.js';
import { serializeCapturedInput } from './captured_input.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(await readFile(path.join(repoRoot,
  'tests/fixtures/elk_parity/manifest.json'), 'utf8'));
const outputRoot = path.resolve(process.argv[2] ?? path.join(repoRoot, 'dc_runs/elk_phase_oracle/inputs'));
const selectedIds = process.argv.slice(3);
// Keep the historical Focused default; full mapped captures require explicit IDs.
const cases = manifest.cases.filter((entry) => ['focused','mapped'].includes(entry.tier)
  && (selectedIds.length === 0 ? entry.tier === 'focused' : selectedIds.includes(entry.id)));
for(const id of selectedIds)assert.ok(cases.some((entry)=>entry.id===id),`unknown product case ${id}`);
const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
await mkdir(outputRoot, { recursive: true });

for (const fixtureCase of cases) {
  const source = await readFile(path.join(repoRoot, fixtureCase.source));
  const design = parseVerilog(source.toString('utf8'));
  const module = design.modules.find((entry) => entry.name === 'tc') ?? design.modules[0];
  const captureComplete = new Error('ELK research input capture complete');
  let elkGraph;
  let displayGraph;
  const provider = new ElkLayoutProvider({ elkFactory: () => ({
    layout: async (input) => {
      elkGraph = structuredClone(input);
      throw captureComplete;
    }
  }) });
  const layout = provider.layout.bind(provider);
  provider.layout = async (graph, options) => {
    displayGraph = structuredClone(graph);
    return layout(graph, options);
  };
  try {
    const query=fixtureCase.query.kind==='full'?{viewMode:'whole'}:{viewMode:'focused',
      ...(fixtureCase.query.kind === 'cell'
        ? { focusedRootNodeIds: [`cell:${fixtureCase.query.value}`] }
        : { focusedRootNetIds: [fixtureCase.query.value] }),
      faninDepth:fixtureCase.query.faninDepth,fanoutDepth:fixtureCase.query.fanoutDepth};
    await buildModuleWorkspace({
      module, moduleLibrary: design.modules,...query,
      useFanoutHubs: true, collapseLargeGroups: false, layoutProvider: provider
    });
    assert.fail('capture provider unexpectedly completed layout');
  } catch (error) {
    if (error !== captureComplete) throw error;
  }
  assert.ok(elkGraph && displayGraph, 'provider input was not captured');
  const captured=serializeCapturedInput(fixtureCase.id,elkGraph,displayGraph,manifest.defaults);
  const {inputDigest,options,graph,inputOrder}=captured;
  const document = { inputVersion: '1.0.0', caseId: fixtureCase.id,
    source: fixtureCase.source, sourceDigest: digest(source), module: module.name,
    query: fixtureCase.query, inputDigest, options, elkGraph,graph,inputOrder,
    providerInputDigest:digest(JSON.stringify(displayGraph)) };
  await writeFile(path.join(outputRoot, `${fixtureCase.id}.json`), `${JSON.stringify(document, null, 2)}\n`);
  await writeFile(path.join(outputRoot, `${fixtureCase.id}.tsv`),
    captured.tsv);
  console.log(JSON.stringify({ caseId: fixtureCase.id, nodes: document.graph.nodes.length,
    edges: graph.edges.length, inputDigest, providerInputDigest:document.providerInputDigest,inputOrder,outputRoot }));
}
