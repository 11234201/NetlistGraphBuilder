import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadPhaseOracles,inputFromSnapshot} from '../../../tests/helpers/elk_phase_inputs.js';
import {createCanonicalGraph} from '../../../src/layout/elk_native/ir.js';
import {orientGraph} from '../../../src/layout/elk_native/p1_orientation.js';
import {assignLayers} from '../../../src/layout/elk_native/p2_layering.js';
import {buildProperGraph} from '../../../src/layout/elk_native/proper_graph.js';
import {orderLayers} from '../../../src/layout/elk_native/p3_ordering.js';
import {createQualityBaseline,sha256} from './quality_baseline.mjs';

// Diagnostic only: never chooses a seed or rewrites the production perturbation key.
export function probeDisplayNameOrdering(input,policy={}){
  const before=JSON.stringify(input);
  const renamed={...input,nodes:input.nodes.map((node)=>({...node,displayName:`display-only:${node.id}`}))};
  const run=(graph)=>{
    const canonical=createCanonicalGraph(graph,policy),oriented=orientGraph(canonical),ranked=assignLayers(oriented);
    const ordered=orderLayers(buildProperGraph(ranked));
    const {inputDigest,phase,phaseData,...p0}=canonical;
    const semantic={...p0,nodes:p0.nodes.map(({displayName,...node})=>node)};
    return {semanticDigest:sha256(JSON.stringify(semantic)),inputDigest,
      orientation:oriented.edges.map(({id,sourcePortId,targetPortId,reversed})=>({id,sourcePortId,targetPortId,reversed})),
      ranks:ranked.nodes.map(({id,layer})=>({id,layer})),layers:ordered.layers,
      crossings:ordered.phaseData.crossings,perturbationKey:ordered.phaseData.perturbationKey};
  };
  const original=run(input),changed=run(renamed);
  assert.equal(JSON.stringify(input),before,'display-name diagnostic mutated the caller input');
  assert.equal(original.semanticDigest,changed.semanticDigest,'diagnostic changed non-display P0 data');
  assert.deepEqual(original.orientation,changed.orientation,'unexpected P1 divergence');
  assert.deepEqual(original.ranks,changed.ranks,'unexpected P2 divergence');
  const changedLayers=original.layers.filter((layer,index)=>JSON.stringify(layer)!==JSON.stringify(changed.layers[index])).map(({index})=>index);
  const firstLayer=changedLayers[0];
  return {scope:'displayName only; identities, measured geometry, ports, edges, policy and P1/P2 unchanged',
    nodeCount:input.nodes.length,edgeCount:input.edges.length,semanticDigest:original.semanticDigest,changedLayers,
    firstOrderDifference:firstLayer===undefined?null:{layer:firstLayer,original:original.layers[firstLayer].nodeIds,
      renamed:changed.layers[firstLayer].nodeIds},
    firstDivergentPhase:changedLayers.length?'p3':null,
    reports:[original,changed].map(({orientation,ranks,layers,...report},index)=>({variant:index?'renamed':'original',...report}))};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=process.argv[2];if(!output)throw new Error('usage: probe_display_name_ordering.mjs <output-dir>');
  await mkdir(output,{recursive:true});
  const repoRoot=fileURLToPath(new URL('../../../',import.meta.url)),baseline=await createQualityBaseline(repoRoot,'q03_display_name');
  await writeFile(path.join(output,'baseline.before.json'),JSON.stringify(baseline,null,2));
  const reports=[];
  for(const oracle of await loadPhaseOracles()){
    const report={caseId:oracle.fixture.caseId,...probeDisplayNameOrdering(inputFromSnapshot(oracle.snapshots[0]))};
    reports.push(report);console.log(JSON.stringify(report));
  }
  await writeFile(path.join(output,'report.json'),JSON.stringify({reports},null,2));
  const after=await createQualityBaseline(repoRoot,'q03_display_name_after');
  await writeFile(path.join(output,'baseline.after.json'),JSON.stringify(after,null,2));
  assert.equal(after.fileSetDigest,baseline.fileSetDigest);
}
