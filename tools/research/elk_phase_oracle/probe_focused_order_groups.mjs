import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parseVerilog} from '../../../src/parser/verilogParser.js';
import {buildModuleWorkspace} from '../../../src/app/moduleWorkspace.js';
import {NativeLayeredLayoutProvider} from '../../../src/layout/elk_native_layout_provider.js';
import {buildFocusedFaninTreeBlocks,summarizeFocusedFaninTreeBlocks} from '../../../src/layout/layered/focusedTreeBlocks.js';
import {scoreOrderGroups} from './order_group_score.mjs';
import {forecastOrderGroupBands} from './order_group_bands.mjs';
import {CohesionResearchProvider} from './probe_cohesion_provider.mjs';
import {createQualityBaseline,sha256} from './quality_baseline.mjs';
const [output,...args]=process.argv.slice(2),layoutUnits=args.includes('--units'),groupSweep=layoutUnits||args.includes('--sweep'),cohesion=groupSweep||args.includes('--cohesion'),
  structuralKey=args.includes('--structural-key'),implicitPorts=args.includes('--implicit-ports'),
  ids=args.filter(arg=>!['--cohesion','--sweep','--structural-key','--implicit-ports','--units'].includes(arg));
if(!output)throw Error('usage: probe_focused_order_groups.mjs <output-dir> [case-ids...]');
await mkdir(output,{recursive:true});
const root=fileURLToPath(new URL('../../../',import.meta.url)),baseline=await createQualityBaseline(root,'focused_order_groups');
await writeFile(`${output}/baseline.before.json`,JSON.stringify(baseline,null,2));
const manifest=JSON.parse(await readFile(new URL('../../../tests/fixtures/elk_parity/manifest.json',import.meta.url),'utf8'));
const selected=new Set(ids.length?ids:['sop015_5426_focused_3_3','eq012_1471_focused_3_3']);
assert.ok([...selected].every(id=>manifest.cases.some(entry=>entry.id===id&&entry.tier==='focused'&&entry.query.kind==='cell')));
for(const entry of manifest.cases.filter(entry=>selected.has(entry.id))){
  const design=parseVerilog(await readFile(new URL(`../../../${entry.source}`,import.meta.url),'utf8'));
  const module=design.modules.find(module=>module.name==='tc')??design.modules[0];
  const Provider=cohesion||structuralKey||implicitPorts?CohesionResearchProvider:NativeLayeredLayoutProvider;
  const provider=new Provider({groupSweep,cohesion,structuralKey,implicitPorts,layoutUnits}),layout=provider.layout.bind(provider),phases=[];
  let decomposition,providerInputDigest;
  provider.layout=async(input,options)=>{
    providerInputDigest=sha256(JSON.stringify(input));
    decomposition=buildFocusedFaninTreeBlocks(input.nodes,input.edges);
    const result=await layout(input,{...options,nativeLayered:{...options.nativeLayered,onPhase:(phase,componentId)=>{
      if(phase.phase==='p3')phases.push({componentId,phase});
    }}});
    assert.equal(sha256(JSON.stringify(input)),providerInputDigest,'input mutated');return result;
  };
  const workspace=await buildModuleWorkspace({module,moduleLibrary:design.modules,viewMode:'focused',
    focusedRootNodeIds:[`cell:${entry.query.value}`],faninDepth:entry.query.faninDepth,fanoutDepth:entry.query.fanoutDepth,
    useFanoutHubs:true,collapseLargeGroups:false,layoutProvider:provider});
  const positioned=new Map(workspace.graph.nodes.map(node=>[node.id,node])),covered=new Set();
  const reports=phases.map(({phase,componentId})=>{
    const members=new Set(phase.nodes.map(node=>node.id)),entries=decomposition.entries.filter(entry=>members.has(entry.nodeId));
    for(const entry of entries){assert.ok(!covered.has(entry.nodeId));covered.add(entry.nodeId);}
    const finalLayers=phase.layers.map(layer=>({...layer,nodeIds:layer.nodeIds.filter(id=>decomposition.membershipByNodeId.has(id))
      .toSorted((a,b)=>positioned.get(a).y-positioned.get(b).y||(a<b?-1:a>b?1:0))}));
    const forecast=forecastOrderGroupBands(phase,entries);
    const finalBands=forecast.bands.map(band=>({...band,nodeIds:band.nodeIds.toSorted((a,b)=>
      positioned.get(a).y-positioned.get(b).y||(a<b?-1:a>b?1:0))}));
    const offsets=new Map(forecast.offsets),offsetErrors=[];
    for(const layer of phase.layers){const ids=layer.nodeIds.filter(id=>decomposition.membershipByNodeId.has(id)),anchor=ids[0];if(!anchor)continue;
      for(const id of ids)if(Math.abs((positioned.get(id).x-positioned.get(anchor).x)-(offsets.get(id)-offsets.get(anchor)))>1e-7)offsetErrors.push(id);}
    return {componentId,crossings:phase.phaseData.crossings,entries,p3Layers:phase.layers,
      p3Score:scoreOrderGroups(phase.layers,entries),finalSameRankScore:scoreOrderGroups(finalLayers,entries),
      forecast,predictedVisualScore:scoreOrderGroups(forecast.bands,entries),finalSameBandScore:scoreOrderGroups(finalBands,entries),offsetErrors,
      cohesion:phase.phaseData.researchCohesion};
  });
  assert.equal(covered.size,decomposition.entries.length,'uncovered group membership');
  const trees=summarizeFocusedFaninTreeBlocks(workspace.graph.nodes,workspace.graph.edges);
  const report={caseId:entry.id,providerInputDigest,rootId:decomposition.rootId,branchRootIds:decomposition.branchRootIds,
    memberCount:decomposition.entries.length,hard:workspace.graph.validationMetrics,components:reports,
    p3Fragments:reports.reduce((sum,component)=>sum+component.p3Score.fragmentedGroupCount,0),
    finalSameRankFragments:reports.reduce((sum,component)=>sum+component.finalSameRankScore.fragmentedGroupCount,0),
    predictedVisualFragments:reports.reduce((sum,component)=>sum+component.predictedVisualScore.fragmentedGroupCount,0),
    finalVisualFragments:trees.fragmentedGroupCount,visualLayers:trees.layers??trees.layerReports};
  await writeFile(`${output}/${entry.id}.report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,components:undefined,visualLayers:undefined}));
}
const after=await createQualityBaseline(root,'focused_order_groups_after');
await writeFile(`${output}/baseline.after.json`,JSON.stringify(after,null,2));
assert.equal(baseline.fileSetDigest,after.fileSetDigest);
