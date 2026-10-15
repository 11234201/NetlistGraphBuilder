import assert from 'node:assert/strict';
import test from 'node:test';
import {instrumentSyncPhases} from '../../tools/research/elk_phase_oracle/sync_phase_timings.mjs';
import {mkdtemp,readFile,readdir,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deserialize} from 'node:v8';

test('research phase timings preserve arguments, defaults, result identity and thrown error',async()=>{
  const source='export function orderLayers(input,{observe=false}={}){if(input.error)throw input.error;return {input,observe};}';
  const transformed=instrumentSyncPhases(source,'test-tag');
  const module=await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`);
  const logs=[],original=console.error;
  console.error=(line)=>logs.push(line);
  try{
    const input={nodeIds:['a']};
    assert.deepEqual(module.orderLayers(input),{input,observe:false});
    assert.strictEqual(module.orderLayers(input,{observe:true}).input,input);
    const error=new Error('same diagnostic');
    assert.throws(()=>module.orderLayers({error}),(actual)=>actual===error);
  }finally{console.error=original;}
  assert.equal(logs.filter((line)=>line.startsWith('phase_timing_begin=')).length,3);
  assert.equal(logs.filter((line)=>line.startsWith('phase_timing_end=')).length,3);
  const ignored='export async function orderLayers(){}\nexport function unrelated(){}';
  assert.equal(instrumentSyncPhases(ignored,'tag'),ignored);
});

test('explicit validation capture preserves full inputs and returns without enabling observation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'elk-validation-capture-'));
  const source='export function validateLayoutGraph(graph,options={}){return {graph,options};}\nexport function orderLayers(graph){return graph;}';
  const transformed=instrumentSyncPhases(source,'capture-test',{captureDirectory:directory});
  const module=await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`);
  const savedError=console.error;console.error=()=>{};
  const file=join(directory,'capture-test.validation.bin');
  try{
    const graph={nodes:[{id:'all-nodes',value:undefined,zero:-0}],edges:[],
      topology:new Map([['all',new Set(['a','b'])]])};
    const options={checkObstacles:true,checkBounds:true};
    assert.strictEqual(module.orderLayers(graph),graph);
    assert.deepEqual(await readdir(directory),[],'unselected phase must not capture');
    const result=module.validateLayoutGraph(graph,options);
    assert.strictEqual(result.graph,graph);assert.strictEqual(result.options,options);
    assert.equal(Object.hasOwn(options,'observe'),false);
    const snapshot=deserialize(await readFile(file));
    assert.deepEqual(snapshot,{phase:'validateLayoutGraph',graph,options});
    assert.ok(Object.is(snapshot.graph.nodes[0].zero,-0));
    module.validateLayoutGraph({nodes:['second-call']});
    assert.deepEqual(deserialize(await readFile(file)),snapshot,'first full phase input remains frozen');
    const wireSource='export function buildWireRoutes(edges){return edges;}';
    const wireModule=await import(`data:text/javascript;base64,${Buffer.from(instrumentSyncPhases(wireSource,
      'wire-test',{captureDirectory:directory,captureBoundary:'buildWireRoutes'})).toString('base64')}`);
    const edges=[{id:'all-edges',points:[{x:-0,y:0},{x:5,y:0}],metadata:{value:undefined}}];
    assert.strictEqual(wireModule.buildWireRoutes(edges),edges);
    assert.deepEqual(deserialize(await readFile(join(directory,'wire-test.wire_routes.bin'))),
      {phase:'buildWireRoutes',edges});
    const orderingModule=await import(`data:text/javascript;base64,${Buffer.from(instrumentSyncPhases(
      'export function orderLayers(graph,options){return {graph,options};}',
      'ordering-test',{captureDirectory:directory,captureBoundary:'orderLayers'})).toString('base64')}`);
    const orderingOptions={observe:false,orderingDigest:'source-key'};
    assert.strictEqual(orderingModule.orderLayers(graph,orderingOptions).graph,graph);
    assert.deepEqual(deserialize(await readFile(join(directory,'ordering-test.ordering.bin'))),
      {phase:'orderLayers',graph,options:orderingOptions});
  }finally{
    console.error=savedError;
    for(const entry of await readdir(directory))await unlink(join(directory,entry));
    await rmdir(directory);
  }
});
