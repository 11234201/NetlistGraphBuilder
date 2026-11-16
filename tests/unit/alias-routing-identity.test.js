import assert from 'node:assert/strict';
import test from 'node:test';
import {parseVerilog} from '../../src/parser/verilogParser.js';
import {buildWorkspaceGraph} from '../../src/app/graphWorkspace.js';
import {queryNetlistView} from '../../src/domains/netlist/netlist_view_query.js';
import {buildModuleWorkspace} from '../../src/app/moduleWorkspace.js';
import {buildCompareWorkspace} from '../../src/app/compareWorkspace.js';
import {getLayoutProvider} from '../../src/layout/layoutProvider.js';
import {getNetGroupKey} from '../../src/layout/layoutTopology.js';
import {validateLayoutGraph} from '../../src/layout/layoutValidator.js';
import {PhaseError} from '../../src/layout/anchor_layered/protocol.js';
import {projectAliasRoutingIdentity} from '../../src/domains/netlist/alias_routing_identity.js';

const loads=Array.from({length:9},(_,i)=>`BUFX1 b${i}(.A(a),.Y(y[${i}]));`).join('\n');
const module=parseVerilog(`module aliases(input d, output [8:0] y, output z);
  wire n,a; assign a=n; BUFX1 driver(.A(d),.Y(n));
  BUFX1 direct(.A(n),.Y(z)); ${loads} endmodule`).modules[0];
const provider=getLayoutProvider('native-layered');
const geometry=(graph)=>({nodes:graph.nodes.map(({id,x,y})=>({id,x,y})).sort((a,b)=>a.id.localeCompare(b.id)),
  edges:graph.edges.map(({id,points})=>({id,points})).sort((a,b)=>a.id.localeCompare(b.id))});

test('folded aliases route in Single and Compare, with and without fanout hubs',async()=>{
  for(const useFanoutHubs of [false,true]) {
    const options={module,layoutProvider:provider,useFanoutHubs,viewMode:'whole'};
    const single=await buildModuleWorkspace(options);
    const compare=await buildCompareWorkspace({...options,leftModule:module,rightModule:module});
    for(const graph of [single.graph,compare.graphs.left,compare.graphs.right]) {
      assert.equal(graph.layoutProvider,'native-layered');
      assert.deepEqual(validateLayoutGraph(graph),[]);
      assert.equal(graph.layoutStatus,'routed');
      assert.ok(graph.edges.some(edge=>edge.net==='a'));
      assert.ok(graph.edges.some(edge=>edge.net==='n'));
      assert.deepEqual(geometry(graph),geometry(single.graph));
    }
    const full=buildWorkspaceGraph(module),before=structuredClone(full);
    const reversed={...full,nodes:full.nodes.toReversed(),edges:full.edges.toReversed(),aliases:full.aliases.toReversed()};
    const permuted=await buildModuleWorkspace({...options,preparedFullGraph:reversed});
    assert.deepEqual(geometry(permuted.graph),geometry(single.graph));
    assert.deepEqual(full,before);
  }
});

test('routing identity preserves logical names and the frozen Simple projection',()=>{
  const full=buildWorkspaceGraph(module),before=structuredClone(full);
  const project=(preserveLegacyProjection)=>queryNetlistView(full,{mode:'whole',preserveLegacyProjection},{useFanoutHubs:false}).visibleGraph;
  assert.deepEqual(project(true),full);
  const active=project(false);
  const branches=active.edges.filter(edge=>edge.source==='cell:driver');
  assert.equal(new Set(branches.map(getNetGroupKey)).size,1);
  assert.deepEqual(active.edges.map(edge=>[edge.id,edge.net,edge.label]),full.edges.map(edge=>[edge.id,edge.net,edge.label]));
  assert.deepEqual(full,before);
  const explicit=buildWorkspaceGraph(module,{showAliases:true});
  assert.equal(queryNetlistView(explicit,{mode:'whole'},{useFanoutHubs:false}).visibleGraph.edges.some(edge=>edge.routingNet),false);
});

test('AnchorLayered diagnostics use the current product name and retain the saved provider ID',()=>{
  assert.equal(provider.label,'AnchorLayered');
  assert.equal(provider.id,'native-layered');
  assert.equal(new PhaseError('p5','foreign-wire-overlap').name,'AnchorLayeredPhaseError');
});

test('alias routing never joins equal constants or independent drivers',()=>{
  const constant={id:'zero',kind:'constant',ref:{name:"1'b0"}};
  const full={nodes:[constant],aliases:[{lhs:'a',rhs:"1'b0"},{lhs:'b',rhs:"1'b0"}],
    edges:[{id:'a',source:'zero',net:'a'},{id:'b',source:'zero',net:'b'}]};
  const focused={...full,nodes:[]};
  assert.deepEqual(projectAliasRoutingIdentity(focused,full),focused);
  const graph={nodes:[],aliases:[{lhs:'a',rhs:'b'}],edges:[{source:'x',net:'a'},{source:'y',net:'b'}]};
  const result=projectAliasRoutingIdentity(graph);
  assert.notEqual(getNetGroupKey(result.edges[0]),getNetGroupKey(result.edges[1]));
});
