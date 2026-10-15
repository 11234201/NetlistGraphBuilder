import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Elk from '../../../vendor/elkjs-0.11.1/lib/elk.bundled.js';
import {layoutGraph} from '../../../src/layout/elk_native/index.js';
import {normalizePolicy} from '../../../src/layout/elk_native/policy.js';
import {materializeSyntheticCase} from '../../../tests/helpers/elk_quality_cases.js';
import {buildWireRoutes} from '../../../src/layout/wireRoutes.js';
import {placeWireLabels} from '../../../src/layout/wireLabelPlacement.js';
import {finalizeLayoutGraph} from '../../../src/layout/layoutValidator.js';
import {getConnectionPoint,computeBoundsWithRoutes,computeSafeLayoutExtent} from '../../../src/layout/nodeGeometry.js';
import {analyzeLayoutQuality} from '../../../src/layout/layoutQuality.js';
import {createSchematicScene} from '../../../src/render/svgRenderer.js';
import {svgElement,svgText,renderSvgScene} from '../../../src/render/svg_scene_renderer.js';
import {createStandaloneSvg} from '../../../src/render/svgExport.js';
import {createQualityBaseline,sha256} from './quality_baseline.mjs';

export function elkInput(input,policy){return {id:'root',layoutOptions:{
  'elk.algorithm':'layered','elk.direction':'RIGHT','elk.edgeRouting':'ORTHOGONAL',
  'elk.randomSeed':String(policy.randomSeed),'elk.layered.thoroughness':String(policy.thoroughness),
  'elk.layered.cycleBreaking.strategy':'GREEDY','elk.layered.layering.strategy':'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy':'LAYER_SWEEP','elk.layered.nodePlacement.strategy':'BRANDES_KOEPF',
  'elk.layered.nodePlacement.favorStraightEdges':String(policy.favorStraightEdges),
  'elk.spacing.nodeNode':String(policy.nodeNodeSpacing),'elk.spacing.edgeEdge':String(policy.edgeEdgeSpacing),
  'elk.spacing.edgeNode':String(policy.edgeNodeSpacing),
  'elk.layered.spacing.nodeNodeBetweenLayers':String(policy.nodeNodeBetweenLayers),
  'elk.layered.spacing.edgeNodeBetweenLayers':String(policy.edgeNodeBetweenLayers)},
  children:input.nodes.map((node)=>({id:node.id,width:node.width,height:node.height,
    layoutOptions:{'elk.portConstraints':'FIXED_POS'},ports:node.ports.map((port)=>({id:port.id,
      x:port.x,y:port.y,width:port.width??0,height:port.height??0,layoutOptions:{'elk.port.side':port.side}}))})),
  edges:input.edges.map((edge)=>({id:edge.id,sources:[edge.sourcePortId],targets:[edge.targetPortId]}))};}

export function positionedGraph(input,positions,routes,provider){
  const owner=new Map(input.nodes.flatMap((node)=>node.ports.map((port)=>[port.id,node.id]))),margin=32;
  const nodes=input.nodes.map((node)=>({...node,kind:'cell',label:node.id,gateKind:'blackbox',
    x:positions.get(node.id).x+margin,y:positions.get(node.id).y+margin,
    ports:node.ports.map((port)=>({...port,pin:port.id,rawPin:port.id,direction:port.side==='EAST'?'output':'input',
      side:port.side==='EAST'?'right':'left',x:port.x+(port.anchor?.x??0),y:port.y+(port.anchor?.y??0)}))}));
  const byId=new Map(nodes.map((node)=>[node.id,node]));
  const routed=input.edges.map((edge)=>{
    const source=owner.get(edge.sourcePortId),target=owner.get(edge.targetPortId);
    const points=routes.get(edge.id).map((point)=>({x:point.x+margin,y:point.y+margin}));
    points[0]=getConnectionPoint(byId.get(source),edge.sourcePortId,'source');
    points[points.length-1]=getConnectionPoint(byId.get(target),edge.targetPortId,'target');
    return {...edge,source,target,sourcePin:edge.sourcePortId,targetPin:edge.targetPortId,
      net:edge.physicalNetId,label:edge.physicalNetId,points,routeStatus:'routed',routeKind:provider};
  });
  const edges=placeWireLabels(routed,nodes),wireRoutes=buildWireRoutes(edges);
  const extent=computeSafeLayoutExtent(computeBoundsWithRoutes(nodes,edges,wireRoutes),margin);
  return finalizeLayoutGraph({nodes,edges,wireRoutes,width:extent.width,height:extent.height,layoutProvider:provider});
}
export async function compareSynthetic(entry,oracle=null){
  const materialized=materializeSyntheticCase(entry,oracle),input=materialized.input;
  const policy=normalizePolicy({nodeNodeSpacing:20,nodeNodeBetweenLayers:20});
  const native=await layoutGraph(structuredClone(input),{policy});
  const reference=await new Elk().layout(elkInput(structuredClone(input),policy));
  const nativeGraph=positionedGraph(input,new Map(native.nodes.map((node)=>[node.id,node])),
    new Map(native.edges.map((edge)=>[edge.id,edge.points])),'native-layered');
  const elkGraph=positionedGraph(input,new Map(reference.children.map((node)=>[node.id,node])),
    new Map(reference.edges.map((edge)=>{
      if(edge.sections?.length!==1)throw new Error(`Unexpected ELK logical section count: ${edge.id}`);
      const section=edge.sections[0];return [edge.id,[section.startPoint,...(section.bendPoints??[]),section.endPoint]];
    })),'elk-layered');
  return {input,policy,provenance:materialized.provenance,graphs:[elkGraph,nativeGraph]};
}
// Abstract oracle boxes are not measured product cells. A BLACKBOX/type/pin
// template assumes >=58px height and overprints 40x30 oracle boxes. Keep every
// anchor and identity, with separate compact display pin names on both sides.
// Product netlist visual acceptance still uses its unchanged Netlist Scene.
export function renderMechanismGraph(graph){
  const createNodePrimitive=(node)=>svgElement('g',{'class':'node mechanism','data-node-id':node.id},[
    svgElement('title',{},[svgText(`${node.id}; ${node.ports.map((port)=>port.id).join('; ')}`)]),
    svgElement('rect',{'class':'node-shape',x:node.x,y:node.y,width:node.width,height:node.height}),
    svgElement('text',{'class':'node-label',x:node.x+node.width/2,y:node.y+node.height/2+2,
      'text-anchor':'middle',style:'font-size:6px'},[svgText(node.label)]),
    ...node.ports.flatMap((port,index)=>[
      svgElement('circle',{'class':'pin-dot',cx:node.x+port.x,cy:node.y+port.y,r:1.5}),
      svgElement('text',{'class':'pin-label',x:node.x+port.x+(port.side==='left'?3:-3),y:node.y+port.y+1,
        'text-anchor':port.side==='left'?'start':'end',style:'font-size:4px'},
      [svgText(`${port.side==='left'?'I':'O'}${index+1}`)])])]);
  return createStandaloneSvg(renderSvgScene(createSchematicScene(graph,{createNodePrimitive})));
}
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [output,...ids]=process.argv.slice(2);if(!output)throw new Error('usage: compare_quality_corpus.mjs <output-dir> [case-ids...]');
  await mkdir(output,{recursive:true});
  const baseline=await createQualityBaseline(repoRoot,path.basename(path.resolve(output)));
  await writeFile(path.join(output,'baseline.before.json'),JSON.stringify(baseline,null,2));
  const manifest=JSON.parse(await readFile(path.join(repoRoot,'tests/fixtures/elk_parity/manifest.json'),'utf8'));
  const reports=[];
  for(const entry of manifest.cases.filter((entry)=>entry.tier==='synthetic'&&(!ids.length||ids.includes(entry.id)))){
    if(entry.mechanismProbe){reports.push({caseId:entry.id,status:'mechanism-probe-not-a-visual-graph'});continue;}
    try{
      let oracle=null;try{oracle=JSON.parse(await readFile(path.join(repoRoot,`tests/fixtures/elk_parity/oracles/${entry.id}.elk.json`),'utf8'));}
      catch(error){if(error.code!=='ENOENT')throw error;}
      const compared=await compareSynthetic(entry,oracle);
      await writeFile(path.join(output,`${entry.id}.input.json`),JSON.stringify({input:compared.input,policy:compared.policy},null,2));
      const metrics=[];
      for(const graph of compared.graphs){
        await writeFile(path.join(output,`${entry.id}.${graph.layoutProvider}.graph.json`),JSON.stringify(graph));
        await writeFile(path.join(output,`${entry.id}.${graph.layoutProvider}.svg`),renderMechanismGraph(graph));
        metrics.push({provider:graph.layoutProvider,width:graph.width,height:graph.height,
          validation:graph.validationMetrics,quality:analyzeLayoutQuality(graph)});
      }
      const candidate=metrics[1],report={caseId:entry.id,status:candidate.validation.total?'hard-failed':'hard-passed-visual-pending',
        provenance:compared.provenance,inputDigest:sha256(JSON.stringify(compared.input)),policy:compared.policy,
        metrics,softVerdict:'observation-only; new scene thresholds not yet accepted',visualReview:'pending'};
      reports.push(report);console.log(JSON.stringify(report));
    }catch(error){const report={caseId:entry.id,status:'failed',error:error.message,diagnostic:error.diagnostic??null};
      reports.push(report);console.log(JSON.stringify(report));}
  }
  const after=await createQualityBaseline(repoRoot,`${baseline.runId}:after`);
  await writeFile(path.join(output,'baseline.after.json'),JSON.stringify(after,null,2));
  if(after.fileSetDigest!==baseline.fileSetDigest)throw new Error('Source/input/tool files changed during the frozen run');
  await writeFile(path.join(output,'summary.json'),JSON.stringify({runId:baseline.runId,frozen:true,runtimeDigest:baseline.runtimeDigest,reports},null,2));
  console.log(JSON.stringify({cases:reports.length,failed:reports.filter((report)=>['failed','hard-failed'].includes(report.status)).length,frozen:true}));
  if(reports.some((report)=>['failed','hard-failed'].includes(report.status)))process.exitCode=1;
}
