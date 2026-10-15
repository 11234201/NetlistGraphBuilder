import assert from 'node:assert/strict';
import test from 'node:test';
import {getLayoutProvider} from '../../src/layout/layoutProvider.js';
import {buildModuleWorkspace} from '../../src/app/moduleWorkspace.js';
import {buildCompareWorkspace} from '../../src/app/compareWorkspace.js';
import {applyWorkspaceOverrides} from '../../src/app/layoutWorkspace.js';
import {parseVerilog} from '../../src/parser/verilogParser.js';
import {renderSvgScene} from '../../src/render/svg_scene_renderer.js';
import {createStandaloneSvg} from '../../src/render/svgExport.js';
import {NativeLayeredLayoutProvider} from '../../src/layout/elk_native_layout_provider.js';

const source=`module left(a,y); input a; output y; BUF u0(.A(a),.Z(y)); endmodule
module right(a,y); input a; output y; INV u1(.I(a),.ZN(y)); endmodule`;

test('registered H08 is default and shares Single/Compare workspace boundaries',async()=>{
  const provider=getLayoutProvider('native-layered');
  assert.equal(provider.profile,'h08');assert.equal(getLayoutProvider().id,'native-layered');
  const [left,right]=parseVerilog(source).modules,before=structuredClone(left);
  const single=await buildModuleWorkspace({module:left,layoutProvider:provider,useFanoutHubs:false});
  assert.equal(single.graph.layoutMetrics.profile.id,'h08');assert.equal(single.graph.validationMetrics.total,0);
  const compared=await buildCompareWorkspace({leftModule:left,rightModule:right,layoutProvider:provider});
  for(const side of ['left','right']){
    assert.equal(compared.graphs[side].layoutMetrics.profile.id,'h08');
    assert.equal(compared.graphs[side].validationMetrics.total,0);
    const svg=createStandaloneSvg(renderSvgScene(compared.scenes[side]));
    assert.match(svg,/<svg/);assert.match(svg,/xmlns=/);
  }
  assert.deepEqual(single.autoGraph.nodes,compared.autoGraphs.left.nodes);
  const snapshot=structuredClone(single.autoGraph),node=single.autoGraph.nodes.find(n=>n.id==='cell:u0');
  const adjusted=applyWorkspaceOverrides(single.autoGraph,{nodePositions:new Map([[node.id,{x:node.x,y:node.y+60}]])});
  assert.equal(adjusted.nodes.find(n=>n.id===node.id).y,node.y+60);
  assert.deepEqual(single.autoGraph,snapshot);assert.deepEqual(left,before);
});

test('H08 Search-first avoids layout and asynchronous workspace cancellation publishes no partial graph',async()=>{
  const module=parseVerilog(source).modules[0],provider=new NativeLayeredLayoutProvider({profile:'h08'});
  let calls=0;const counted={id:provider.id,layout(...args){calls++;return provider.layout(...args);}};
  const search=await buildModuleWorkspace({module,layoutProvider:counted,viewMode:'search-first'});
  assert.equal(calls,0);assert.equal(search.graph.nodes.length,0);
  const controller=new AbortController();
  const pending=buildModuleWorkspace({module,layoutProvider:counted,signal:controller.signal});
  controller.abort();await assert.rejects(pending,{name:'AbortError'});
});
