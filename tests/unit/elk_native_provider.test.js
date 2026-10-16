import assert from 'node:assert/strict';
import test from 'node:test';
import {NativeLayeredLayoutProvider} from '../../src/layout/elk_native_layout_provider.js';
import {getConnectionPoint} from '../../src/layout/nodeGeometry.js';
import {parseVerilog} from '../../src/parser/verilogParser.js';
import {buildSchematicGraph} from '../../src/netlist/graph.js';

function makeGraph(){
  return {moduleName:'adapter',nodes:[
    {id:'in',kind:'input',label:'in'},
    {id:'a',kind:'cell',label:'\\escaped[3] ',gateKind:'unknown',portDescriptors:[
      {pin:'A',rawPin:'A',direction:'input',side:'left'},
      {pin:'ZN',rawPin:'ZN',direction:'output',side:'right'}]},
    {id:'b',kind:'output',label:'b'}, {id:'c',kind:'output',label:'c'}],
    edges:[{id:'ia',source:'in',target:'a',targetPin:'A',net:'input'},
      {id:'ab',source:'a',sourcePin:'ZN',target:'b',net:'fan'},
      {id:'ac',source:'a',sourcePin:'ZN',target:'c',net:'fan'}]};
}
function geometry(graph){return {
  nodes:graph.nodes.map(({id,x,y,width,height})=>({id,x,y,width,height})).sort((a,b)=>a.id.localeCompare(b.id)),
  edges:graph.edges.map(({id,points})=>({id,points})).sort((a,b)=>a.id.localeCompare(b.id)),
  metrics:graph.layoutMetrics,diagnostics:graph.providerDiagnostics};}

test('elk_native provider preserves source DTO, escaped names and physical fanout under permutations',async()=>{
  const input=makeGraph(),before=structuredClone(input),provider=new NativeLayeredLayoutProvider();
  const result=await provider.layout(input);
  assert.deepEqual(input,before);
  assert.equal(result.layoutStatus,'routed');assert.equal(result.validationMetrics.total,0);
  assert.equal(result.nodes.find((node)=>node.id==='a').label,'\\escaped[3] ');
  assert.deepEqual(geometry(await provider.layout({...input,nodes:input.nodes.toReversed(),edges:input.edges.toReversed()})),geometry(result));
  const physical=result.wireRoutes.find((route)=>route.logicalEdgeIds.includes('ab'));
  assert.deepEqual([...physical.logicalEdgeIds].sort(),['ab','ac']);
  assert.equal(physical.componentCount,1);assert.equal(physical.cycleCount,0);
  const byId=new Map(result.nodes.map((node)=>[node.id,node]));
  for(const edge of result.edges){
    assert.deepEqual(edge.points[0],getConnectionPoint(byId.get(edge.source),edge.sourcePin,'source'));
    assert.deepEqual(edge.points.at(-1),getConnectionPoint(byId.get(edge.target),edge.targetPin,'target'));
  }
});
test('elk_native provider returns an empty shell and rejects cancellation/missing nodes without fallback',async()=>{
  const provider=new NativeLayeredLayoutProvider();
  const empty=await provider.layout({nodes:[],edges:[]});
  assert.equal(empty.layoutStatus,'routed');assert.deepEqual(empty.nodes,[]);
  await assert.rejects(provider.layout(makeGraph(),{signal:AbortSignal.abort()}),{name:'AbortError'});
  await assert.rejects(provider.layout({nodes:[],edges:[{id:'bad',source:'absent',target:'missing'}]}),
    (error)=>error.diagnostic.invariant==='missing-endpoint-node');
});

test('H08 routes each concat terminal independently on both input and output pins',async()=>{
  const design=parseVerilog(`module concat_ports(input a, b, output x, y);
    UNKNOWN u (.A({a,b}), .Z({x,y})); endmodule`);
  const input=buildSchematicGraph(design.modules[0]),before=structuredClone(input);
  const provider=new NativeLayeredLayoutProvider({profile:'h08'});
  const result=await provider.layout(input);
  assert.equal(result.layoutStatus,'routed');
  assert.equal(result.validationMetrics.total,0);
  assert.deepEqual(input,before);
  const cell=result.nodes.find((node)=>node.id==='cell:u');
  assert.equal(new Set(cell.ports.map((port)=>`${port.x},${port.y}`)).size,4);
  for(const edge of result.edges){
    const source=result.nodes.find((node)=>node.id===edge.source);
    const target=result.nodes.find((node)=>node.id===edge.target);
    const pin=edge.source==='cell:u'?edge.sourcePin:edge.targetPin;
    const port=cell.ports.find((entry)=>entry.pin===pin);
    assert.ok(port,pin);
    assert.deepEqual(edge.points[edge.source==='cell:u'?0:edge.points.length-1],
      {x:cell.x+port.x,y:cell.y+port.y});
    assert.deepEqual(edge.points[0],getConnectionPoint(source,edge.sourcePin,'source'));
    assert.deepEqual(edge.points.at(-1),getConnectionPoint(target,edge.targetPin,'target'));
  }
  assert.deepEqual(geometry(await provider.layout({...input,nodes:input.nodes.toReversed(),edges:input.edges.toReversed()})),geometry(result));
});
