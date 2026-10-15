import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseVerilog } from '../../../src/parser/verilogParser.js';
import { buildModuleWorkspace } from '../../../src/app/moduleWorkspace.js';
import { ElkLayoutProvider } from '../../../src/layout/elkLayoutProvider.js';
import { NativeLayeredLayoutProvider } from '../../../src/layout/elk_native_layout_provider.js';
import Elk from '../../../vendor/elkjs-0.11.1/lib/elk.bundled.js';
import { renderSchematicSvg } from '../../../src/domains/netlist/netlist_scene.js';
import { createStandaloneSvg } from '../../../src/render/svgExport.js';
import { analyzeLayoutQuality } from '../../../src/layout/layoutQuality.js';
import { summarizeFocusedFaninTreeBlocks } from '../../../src/layout/layered/focusedTreeBlocks.js';
import {createQualityBaseline,sha256} from './quality_baseline.mjs';
import {fileURLToPath} from 'node:url';

const manifest=JSON.parse(await readFile(new URL('../../../tests/fixtures/elk_parity/manifest.json',import.meta.url),'utf8'));
const output=resolve(process.argv[2]??'dc_runs/elk_native_acceptance');await mkdir(output,{recursive:true});
const selected=new Set(process.argv.slice(3));
const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
const baseline=await createQualityBaseline(repoRoot,'q02_product');
await writeFile(resolve(output,'baseline.before.json'),JSON.stringify(baseline,null,2));
for(const entry of manifest.cases.filter((entry)=>['focused','mapped'].includes(entry.tier)&&
  (!selected.size?entry.tier==='focused':selected.has(entry.id)))){
  const design=parseVerilog(await readFile(new URL(`../../../${entry.source}`,import.meta.url),'utf8'));
  const module=design.modules.find((module)=>module.name==='tc')??design.modules[0];
  const reports=[];
  for(const provider of [new ElkLayoutProvider({elkFactory:()=>new Elk()}),new NativeLayeredLayoutProvider()]){
    const started=performance.now();
    let providerInputDigest;
    const layout=provider.layout.bind(provider);
    provider.layout=async(input,options)=>{
      providerInputDigest=sha256(JSON.stringify(input));
      const result=await layout(input,options);
      if(sha256(JSON.stringify(input))!==providerInputDigest)throw new Error('Provider mutated its input');
      return result;
    };
    const query=entry.query.kind==='full'?{viewMode:'whole'}:{viewMode:'focused',
      ...(entry.query.kind==='cell'?{focusedRootNodeIds:[`cell:${entry.query.value}`]}:{focusedRootNetIds:[entry.query.value]}),
      faninDepth:entry.query.faninDepth,fanoutDepth:entry.query.fanoutDepth};
    const workspace=await buildModuleWorkspace({module,moduleLibrary:design.modules,...query,
      useFanoutHubs:true,collapseLargeGroups:false,layoutProvider:provider});
    const graph=workspace.graph,svg=createStandaloneSvg(renderSchematicSvg(graph));
    await writeFile(resolve(output,`${entry.id}.${provider.id}.svg`),svg);
    await writeFile(resolve(output,`${entry.id}.${provider.id}.graph.json`),JSON.stringify(graph));
    const quality=analyzeLayoutQuality(graph),trees=summarizeFocusedFaninTreeBlocks(graph.nodes,graph.edges);
    const xs=graph.nodes.map((node)=>node.x).sort((a,b)=>a-b);
    let visualColumnCount=0,columnAnchor=null;
    for(const x of xs)if(columnAnchor===null||Math.abs(x-columnAnchor)>2){visualColumnCount++;columnAnchor=x;}
    reports.push({provider:provider.id,providerInputDigest,elapsedMs:performance.now()-started,nodes:graph.nodes.length,edges:graph.edges.length,visualColumnCount,
      width:graph.width,height:graph.height,area:graph.width*graph.height,validation:graph.validationMetrics,
      quality,trees,metrics:graph.layoutMetrics});
  }
  const [elk,native]=reports;
  if(elk.providerInputDigest!==native.providerInputDigest)throw new Error(`Provider inputs differ for ${entry.id}`);
  const gates={hardGeometry:native.validation.total===0,
    ...(entry.id==='sop015_5426_focused_3_3'?{
      columns:native.visualColumnCount>=10||(native.quality.crossingCount<=elk.quality.crossingCount&&native.quality.totalLength<=elk.quality.totalLength),
      crossings:native.quality.crossingCount<=1.5*elk.quality.crossingCount+10,
      physicalCrossings:native.quality.physicalCrossingCount<=1.5*elk.quality.physicalCrossingCount+10,
      wireLength:native.quality.totalLength<=1.5*elk.quality.totalLength
    }:{})};
  const report={caseId:entry.id,query:entry.query,reports,gates};
  await writeFile(resolve(output,`${entry.id}.report.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify({caseId:entry.id,gates,reports:reports.map(({provider,width,height,validation,quality,trees,visualColumnCount})=>
    ({provider,width,height,validation,quality,visualColumnCount,fragmentedGroupCount:trees.fragmentedGroupCount}))}));
}
const after=await createQualityBaseline(repoRoot,'q02_product_after');
await writeFile(resolve(output,'baseline.after.json'),JSON.stringify(after,null,2));
if(after.fileSetDigest!==baseline.fileSetDigest)throw new Error('Source/input/tool files changed during product comparison');
