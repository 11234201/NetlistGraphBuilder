import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parseVerilog} from '../../../src/parser/verilogParser.js';
import {buildModuleWorkspace} from '../../../src/app/moduleWorkspace.js';
import {CohesionResearchProvider} from './probe_cohesion_provider.mjs';
import {createQualityBaseline,sha256} from './quality_baseline.mjs';
const [output,...ids]=process.argv.slice(2);assert.ok(output);
await mkdir(output,{recursive:true});
const root=fileURLToPath(new URL('../../../',import.meta.url)),before=await createQualityBaseline(root,'physical_anchor_causality');
await writeFile(`${output}/baseline.before.json`,JSON.stringify(before,null,2));
const manifest=JSON.parse(await readFile(new URL('../../../tests/fixtures/elk_parity/manifest.json',import.meta.url),'utf8'));
const selected=new Set(ids.length?ids:['sop015_5426_focused_3_3','eq012_1471_focused_3_3','eq012_clk_focused_1_1','mapped_large_dp002']);
assert.ok([...selected].every(id=>manifest.cases.some(entry=>entry.id===id)));
for(const entry of manifest.cases.filter(entry=>selected.has(entry.id))){
  const design=parseVerilog(await readFile(new URL(`../../../${entry.source}`,import.meta.url),'utf8'));
  const module=design.modules.find(module=>module.name==='tc')??design.modules[0],controls=[];
  for(const physicalAnchors of [false,true]){
    const preP5=[],routing=[];
    const provider=new CohesionResearchProvider({groupSweep:true,structuralKey:true,implicitPorts:true,layoutUnits:true,physicalAnchors});
    const layout=provider.layout.bind(provider);
    provider.layout=async(input,options)=>{
      const digest=sha256(JSON.stringify(input));
      const result=await layout(input,{...options,nativeLayered:{...options.nativeLayered,onPhase:(phase,componentId)=>{
        if(phase.phase==='p5'){
          const boundaries=phase.phaseData.events.filter(event=>event.stage==='dependencies');
          routing.push({componentId,segmentCount:boundaries.reduce((sum,event)=>sum+event.segments.length,0),
            aliasGroups:boundaries.reduce((sum,event)=>sum+(event.physicalAnchorAliases?.groupCount??0),0),
            aliasLinks:boundaries.reduce((sum,event)=>sum+(event.physicalAnchorAliases?.linkCount??0),0)});
        }else if(!['restored','complete'].includes(phase.phase))preP5.push({componentId,phase:phase.phase,digest:sha256(JSON.stringify(phase))});
      }}});
      assert.equal(sha256(JSON.stringify(input)),digest,'provider input mutated');return result;
    };
    const query=entry.query.kind==='full'?{viewMode:'whole'}:{viewMode:'focused',
      ...(entry.query.kind==='cell'?{focusedRootNodeIds:[`cell:${entry.query.value}`]}:{focusedRootNetIds:[entry.query.value]}),
      faninDepth:entry.query.faninDepth,fanoutDepth:entry.query.fanoutDepth};
    const workspace=await buildModuleWorkspace({module,moduleLibrary:design.modules,...query,useFanoutHubs:true,
      collapseLargeGroups:false,layoutProvider:provider});
    assert.ok(preP5.some(item=>item.phase==='p4'),'phase observer did not reachP4');
    controls.push({physicalAnchors,preP5,routing,width:workspace.graph.width,height:workspace.graph.height,
      hard:workspace.graph.validationMetrics,inputDigest:workspace.graph.layoutMetrics.inputDigest});
  }
  assert.deepEqual(controls[1].preP5,controls[0].preP5,'P5 policy changed an upstream boundary');
  assert.equal(controls[1].inputDigest,controls[0].inputDigest);
  const report={caseId:entry.id,samePreP5:true,controls};
  await writeFile(`${output}/${entry.id}.report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,controls:controls.map(({preP5,...control})=>({...control,upstreamBoundaries:preP5.length}))}));
}
const after=await createQualityBaseline(root,'physical_anchor_causality_after');
await writeFile(`${output}/baseline.after.json`,JSON.stringify(after,null,2));assert.equal(before.fileSetDigest,after.fileSetDigest);
