import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {compareSynthetic,elkInput,renderMechanismGraph} from '../../tools/research/elk_phase_oracle/compare_quality_corpus.mjs';
import {materializeSyntheticCase} from '../helpers/elk_quality_cases.js';
import {normalizePolicy} from '../../src/layout/elk_native/policy.js';
const manifest=JSON.parse(await readFile(new URL('../fixtures/elk_parity/manifest.json',import.meta.url),'utf8'));
test('quality comparison uses identical fixed port input and shared validation without changing source data',async()=>{
  const entry=manifest.cases.find((entry)=>entry.id==='chain_4'),before=structuredClone(entry);
  const compared=await compareSynthetic(entry);
  assert.deepEqual(entry,before);
  for(const graph of compared.graphs){
    assert.equal(graph.validationMetrics.total,0);assert.equal(graph.nodes.length,4);assert.equal(graph.edges.length,3);
    const beforeRender=structuredClone(graph),svg=renderMechanismGraph(graph);
    assert.ok(!svg.includes('BLACKBOX'));
    for(const node of graph.nodes)assert.ok(svg.includes(`data-node-id="${node.id}"`));
    assert.deepEqual(graph,beforeRender);
  }
  const dto=materializeSyntheticCase(entry).input,reference=elkInput(dto,normalizePolicy());
  assert.deepEqual(reference.children.flatMap((node)=>node.ports.map((port)=>port.id)),dto.nodes.flatMap((node)=>node.ports.map((port)=>port.id)));
  assert.deepEqual(reference.edges.map((edge)=>edge.sources[0]),dto.edges.map((edge)=>edge.sourcePortId));
});
