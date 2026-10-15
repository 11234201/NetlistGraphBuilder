// Read-only phase witness for a specific quality counterexample, not CPU profiling.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {parseVerilog} from '../../../src/parser/verilogParser.js';
import {buildModuleWorkspace} from '../../../src/app/moduleWorkspace.js';
import {NativeLayeredLayoutProvider} from '../../../src/layout/elk_native_layout_provider.js';
import {sha256} from './quality_baseline.mjs';
const [source,edgeId,output]=process.argv.slice(2);
if(!output)throw new Error('usage: trace_quality_edge.mjs <source.v> <canonical-edge-id> <output-dir>');
await mkdir(output,{recursive:true});
const bytes=await readFile(source),design=parseVerilog(bytes.toString('utf8'));
const module=design.modules.find((module)=>module.name==='tc')??design.modules[0];
const provider=new NativeLayeredLayoutProvider(),original=provider.layout.bind(provider),phases=[];
let inputDigest;
provider.layout=(graph,options)=>{
  inputDigest=sha256(JSON.stringify(graph));
  return original(graph,{...options,nativeLayered:{onPhase:async(phase,componentId)=>{
    const logical=(phase.logicalEdges??phase.edges).find((edge)=>edge.id===edgeId);
    if(!logical)return;
    const chain=phase.chains?.find((chain)=>chain.logicalEdgeId===edgeId);
    const trackedEdges=phase.edges.filter((edge)=>edge.id===edgeId||edge.logicalEdgeId===edgeId);
    const owners=new Map(phase.nodes.flatMap((node)=>node.ports.map((port)=>[port.id,node.id])));
    const ids=new Set(trackedEdges.flatMap((edge)=>[owners.get(edge.sourcePortId),owners.get(edge.targetPortId)]));
    for(const id of chain?.dummyNodeIds??[])ids.add(id);
    const nodes=phase.nodes.filter((node)=>ids.has(node.id));
    const summary={phase:phase.phase,componentId,totalNodes:phase.nodes.length,
      graphInputDigest:phase.inputDigest,
      normalNodes:phase.nodes.filter((node)=>node.kind==='normal').map(({id,layer,order,ports})=>
        ({id,layer,order,...(phase.phase==='p0'?{ports}: {})})),
      dummyCount:chain?.dummyNodeIds.length??0,chainNodeIds:chain?.dummyNodeIds??[],
      nodes:nodes.map(({id,kind,layer,order,y,ports})=>({id,kind,layer,order,y,ports})),
      segments:trackedEdges.map(({id,sourceNodeId,targetNodeId,bendPoints})=>({id,sourceNodeId,targetNodeId,bendPoints}))};
    if(phase.phase==='p1')summary.orientedEdges=phase.edges.map(({id,sourceNodeId,targetNodeId,reversed})=>
      ({id,sourceNodeId,targetNodeId,reversed}));
    if(phase.phase==='p2')summary.ranking={objectiveWeightedSpan:phase.phaseData.objectiveWeightedSpan,
      optimal:phase.phaseData.optimal,components:phase.phaseData.components.map(({iterationLimit,termination,pivotCount})=>
        ({iterationLimit,termination,pivotCount}))};
    if(phase.phase==='p4'){
      summary.selected=phase.phaseData.selected;
      summary.candidates=phase.phaseData.candidates.map((candidate)=>({direction:candidate.direction,feasible:candidate.feasible,size:candidate.size,
        root:candidate.root.filter(([id])=>ids.has(id)),nodeY:candidate.nodeY.filter(([id])=>ids.has(id))}));
    }
    phases.push(summary);
  }}});
};
const workspace=await buildModuleWorkspace({module,moduleLibrary:design.modules,viewMode:'whole',
  useFanoutHubs:true,collapseLargeGroups:false,layoutProvider:provider});
const edge=workspace.graph.edges.find((edge)=>edge.id===edgeId);
if(!edge)throw new Error(`Missing tracked edge ${edgeId}`);
const result={source,sourceDigest:sha256(bytes),providerInputDigest:inputDigest,edgeId,phases,
  final:{points:edge.points,validation:workspace.graph.validationMetrics,layoutStatus:workspace.graph.layoutStatus}};
await writeFile(path.join(output,'phase_witness.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({edgeId,providerInputDigest:inputDigest,validation:result.final.validation,
  phases:phases.map((phase)=>({phase:phase.phase,dummyCount:phase.dummyCount,selected:phase.selected,
    distinctY:new Set(phase.nodes.filter((node)=>node.kind==='long_edge').map((node)=>node.y)).size}))}));
