import test from 'node:test';
import assert from 'node:assert/strict';
import {serializeCapturedInput} from '../../tools/research/elk_phase_oracle/captured_input.mjs';
import {sha256} from '../../tools/research/elk_phase_oracle/quality_baseline.mjs';

test('upstream capture preserves provider node/port/edge order, exact geometry and physical net identity',()=>{
  const port=(id,side,x,y)=>({id,x,y,width:0,height:0,layoutOptions:{'elk.port.side':side}});
  const elkGraph={layoutOptions:{'elk.spacing.nodeNode':'48','elk.layered.spacing.nodeNodeBetweenLayers':'80'},
    children:[{id:'z',width:40,height:30,ports:[port('z2','EAST',40,20),port('z1','EAST',40,10)]},
      {id:'a',width:40,height:30,ports:[port('a_in','WEST',0,15)]}],
    edges:[{id:'e2',sources:['z2'],targets:['a_in']},{id:'e1',sources:['z1'],targets:['a_in']}]};
  const displayGraph={edges:[{id:'e1',source:'z',net:'n1'},{id:'e2',source:'z',net:'n2'}]};
  const before=structuredClone({elkGraph,displayGraph});
  const result=serializeCapturedInput('capture_probe',elkGraph,displayGraph,{});
  assert.deepEqual(result.graph.nodes.map((node)=>node.id),['z','a']);
  assert.deepEqual(result.graph.nodes[0].ports.map((entry)=>entry.id),['z2','z1']);
  assert.deepEqual(result.graph.edges.map((edge)=>[edge.id,edge.physicalNet]),[['e2','z\u0000n2'],['e1','z\u0000n1']]);
  const rows=result.tsv.split('\n');
  assert.equal(rows[0].split('\t')[2],sha256(result.tsv.slice(result.tsv.indexOf('\n')+1)));
  assert.deepEqual(rows.filter((row)=>row.startsWith('NODE')).map((row)=>Buffer.from(row.split('\t')[1],'base64').toString()),['z','a']);
  assert.deepEqual({elkGraph,displayGraph},before);
  assert.throws(()=>serializeCapturedInput('../unsafe',elkGraph,displayGraph,{}),/unsafe/);
  assert.throws(()=>serializeCapturedInput('capture_probe',elkGraph,{edges:[]},{}),/missing display edge/);
});

test('upstream capture keeps implicit node endpoints rather than inventing fixed hub ports',()=>{
  const elkGraph={layoutOptions:{'elk.spacing.nodeNode':'48','elk.layered.spacing.nodeNodeBetweenLayers':'80'},
    children:[{id:'hub',width:8,height:8,ports:[]},{id:'sink',width:40,height:30,
      ports:[{id:'in',x:0,y:15,width:0,height:0,layoutOptions:{'elk.port.side':'WEST'}}]}],
    edges:[{id:'edge',sources:['hub'],targets:['in']}]};
  const result=serializeCapturedInput('implicit_endpoint',elkGraph,{edges:[{id:'edge',source:'hub',net:'n'}]},{});
  assert.equal(result.graph.edges[0].sourceEndpointKind,'node');
  assert.equal(result.graph.edges[0].sourceEndpointId,'hub');
  assert.equal(result.graph.edges[0].targetEndpointKind,'port');
  assert.equal(result.graph.nodes[0].ports.length,0);
  assert.equal(result.tsv.split('\n').filter((row)=>row.startsWith('PORT')).length,1);
});
