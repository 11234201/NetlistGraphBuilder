import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph,CONTRACT_VERSION } from '../../src/layout/elk_native/index.js';
import { loadPhaseOracles,inputFromSnapshot } from '../helpers/elk_phase_inputs.js';
import { validateRoutes } from '../../src/layout/elk_native/validate_routes.js';
const corpus=await loadPhaseOracles();

test('elk_native clone-importable package publishes only immutable validated complete geometry',async()=>{
  for(const oracle of corpus){
    const input=inputFromSnapshot(oracle.snapshots[0]),before=structuredClone(input),phases=[];
    const observed=await layoutGraph(input,{onPhase:(graph)=>phases.push(graph.phase)});
    const result=await layoutGraph(input);
    assert.equal(result.phase,'complete');assert.equal(result.contractVersion,CONTRACT_VERSION);
    assert.ok(Object.isFrozen(result.edges[0].points[0]));
    assert.deepEqual(observed,result);assert.deepEqual(input,before);validateRoutes(result);
    assert.ok(phases.includes('p4')&&phases.includes('p5'));
    assert.deepEqual(await layoutGraph({...input,nodes:[...input.nodes].reverse(),edges:[...input.edges].reverse()}),result);
  }
});

test('elk_native package separates complete disconnected graphs and supports empty/isolated input',async()=>{
  const node=(id)=>({id,width:40,height:30,ports:[]});
  const result=await layoutGraph({nodes:[node('a'),node('b'),node('c')],edges:[]});
  assert.equal(result.nodes.length,3);assert.equal(result.phaseData.components.length,3);
  for(let i=0;i<result.phaseData.placements.length;i++)for(let j=i+1;j<result.phaseData.placements.length;j++){
    const a=result.phaseData.placements[i],b=result.phaseData.placements[j];
    assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
  }
  assert.deepEqual((await layoutGraph({nodes:[],edges:[]})).nodes,[]);
});

test('elk_native package cancellation and phase failure cannot publish partial geometry',async()=>{
  const input=inputFromSnapshot(corpus[0].snapshots[0]),controller=new AbortController();
  await assert.rejects(layoutGraph(input,{signal:AbortSignal.abort()}),{name:'AbortError'});
  await assert.rejects(layoutGraph(input,{signal:controller.signal,onPhase:(graph)=>{
    if(graph.phase==='p2')controller.abort();}}),{name:'AbortError'});
});

test('elk_native disconnected components retain the entry snapshot across asynchronous observers',async()=>{
  const input={nodes:['a','b'].map((id)=>({id,width:40,height:30,
    portConstraints:'FIXED_ORDER',ports:[{id:`${id}:in`,side:'WEST',order:7,x:0,y:10}]})),edges:[]};
  const expected=await layoutGraph(input);
  let changed=false;
  const actual=await layoutGraph(input,{onPhase:async()=>{
    if(changed)return;
    changed=true;
    input.nodes[1].width=400;
    input.nodes[1].ports[0].y=999;
    input.nodes.length=0;
    await Promise.resolve();
  }});
  assert.deepEqual(actual,expected);
});
