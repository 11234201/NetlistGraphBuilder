import { readFile } from 'node:fs/promises';
import { parseVerilog } from '../../../src/parser/verilogParser.js';
import { buildSchematicGraph } from '../../../src/netlist/graph.js';
import { applyWorkspaceGraphTransforms } from '../../../src/app/graphWorkspace.js';
import { NativeLayeredLayoutProvider } from '../../../src/layout/elk_native_layout_provider.js';
import { nodeBox,orthogonalSegmentIntersectsBox } from '../../../src/layout/orthogonalRouting.js';

const design=parseVerilog(await readFile(process.argv[2],'utf8'));
const module=design.modules.find((item)=>item.name==='tc')??design.modules[0];
const input=applyWorkspaceGraphTransforms(buildSchematicGraph(module),{collapseLargeGroups:false});
let previous=performance.now(),checkpoint=0;
const observe=process.env.OBSERVE_PHASE_SNAPSHOTS==='1';
const graph=await new NativeLayeredLayoutProvider().layout(input,{nativeLayered:{...(observe?{onPhase:(phase,componentId)=>{
  const now=performance.now();
  console.error(JSON.stringify({phase:phase.phase,componentId,elapsedMs:Math.round(now-previous),nodes:phase.nodes.length,edges:phase.edges.length}));
  previous=now;
}}:{yieldControl:()=>{
  const now=performance.now();
  console.error(JSON.stringify({checkpoint:checkpoint++,elapsedMs:Math.round(now-previous)}));previous=now;
}})}});
for(const violation of graph.layoutDiagnostics??[]){
  const node=graph.nodes.find((item)=>item.id===violation.nodeId);
  const wire=graph.wireRoutes.find((item)=>item.id===violation.edgeId);
  console.log(JSON.stringify({violation,node:node&&{id:node.id,x:node.x,y:node.y,width:node.width,height:node.height},
    wire:wire&&{id:wire.id,segments:wire.segments.filter((segment)=>!node||
      orthogonalSegmentIntersectsBox(segment.start,segment.end,nodeBox(node)))}}));
}
console.log(JSON.stringify({layoutStatus:graph.layoutStatus,validation:graph.validationMetrics,diagnostics:graph.providerDiagnostics}));
