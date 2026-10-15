import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseVerilog } from '../../src/parser/verilogParser.js';
import { buildModuleWorkspace } from '../../src/app/moduleWorkspace.js';
import { NativeLayeredLayoutProvider } from '../../src/layout/elk_native_layout_provider.js';
import { getConnectionPoint } from '../../src/layout/nodeGeometry.js';
import { summarizeFocusedFaninTreeBlocks } from '../../src/layout/layered/focusedTreeBlocks.js';
import { analyzeLayoutQuality } from '../../src/layout/layoutQuality.js';
import { ElkLayoutProvider } from '../../src/layout/elkLayoutProvider.js';
import Elk from '../../vendor/elkjs-0.11.1/lib/elk.bundled.js';
const cases=[['sop/sop_015_mapped.v',{focusedRootNodeIds:['cell:_5426_'],faninDepth:3,fanoutDepth:3}],
  ['equal/eq_012_mapped.v',{focusedRootNodeIds:['cell:_1471_'],faninDepth:3,fanoutDepth:3}],
  ['equal/eq_012_mapped.v',{focusedRootNetIds:['clk'],faninDepth:1,fanoutDepth:1}]];
for(const [file,query] of cases){
  test(`elk_native candidate adapter routes focused ${file}/${JSON.stringify(query)} without repairs`,async()=>{
    const design=parseVerilog(await readFile(new URL(`../fixtures/mapped/${file}`,import.meta.url),'utf8'));
    const module=design.modules.find((entry)=>entry.name==='tc')??design.modules[0];
    const workspace=await buildModuleWorkspace({module,moduleLibrary:design.modules,viewMode:'focused',...query,
      useFanoutHubs:true,collapseLargeGroups:false,layoutProvider:new NativeLayeredLayoutProvider()});
    assert.equal(workspace.graph.layoutStatus,'routed',JSON.stringify(workspace.graph.layoutDiagnostics));
    assert.equal(workspace.graph.validationMetrics.total,0);
    assert.ok(workspace.graph.edges.every((edge)=>edge.points.length>=2));
    const quality=analyzeLayoutQuality(workspace.graph);
    assert.equal(quality.forestRouteCount,0);
    assert.equal(quality.treeFallbackCount,0);
    assert.equal(quality.cycleCount,0);
    const trees=summarizeFocusedFaninTreeBlocks(workspace.graph.nodes,workspace.graph.edges);
    if(query.focusedRootNodeIds?.[0]==='cell:_1471_'){
      assert.equal(trees.branchCount,4);
      assert.equal(trees.hierarchy.sharedGroups.length,2);
      // Contiguity is a readability preference, not physical-net connectivity.
      // Compare to the same-run reference: ELK itself is not zero-fragment here.
      const reference=await buildModuleWorkspace({module,moduleLibrary:design.modules,viewMode:'focused',...query,
        useFanoutHubs:true,collapseLargeGroups:false,layoutProvider:new ElkLayoutProvider({elkFactory:()=>new Elk()})});
      const referenceTrees=summarizeFocusedFaninTreeBlocks(reference.graph.nodes,reference.graph.edges);
      assert.ok(trees.fragmentedGroupCount<=referenceTrees.fragmentedGroupCount,
        `candidate fragments ${trees.fragmentedGroupCount}, same-run ELK ${referenceTrees.fragmentedGroupCount}`);
    }
    if(query.focusedRootNodeIds?.[0]==='cell:_5426_'){
      assert.ok(workspace.graph.edges.some((edge)=>edge.source==='cell:_5404_'&&edge.target==='cell:_5426_'&&edge.targetPin==='S'));
      assert.equal(trees.fragmentedGroupCount,0);
    }
    const byId=new Map(workspace.graph.nodes.map((node)=>[node.id,node]));
    for(const edge of workspace.graph.edges){
      assert.deepEqual(edge.points[0],getConnectionPoint(byId.get(edge.source),edge.sourcePin,'source'));
      assert.deepEqual(edge.points.at(-1),getConnectionPoint(byId.get(edge.target),edge.targetPin,'target'));
    }
  });
}
