import assert from 'node:assert/strict';
import test from 'node:test';
import {loadPhaseOracles} from '../helpers/elk_phase_inputs.js';
import {properInputFromOracle} from '../../tools/research/elk_phase_oracle/upstream_proper_input.mjs';
import {compileWorkingOrderProbe,compileWorkingOrderProvider} from '../../tools/research/elk_phase_oracle/probe_p3_working_order.mjs';
import {orderLayers} from '../../src/layout/elk_native/p3_ordering.js';
test('working-order research observer proves attempt continuity without changing baseline',async()=>{
  const oracle=(await loadPhaseOracles()).find(entry=>entry.fixture.caseId==='sop015_5426_focused_3_3');
  const input=properInputFromOracle(oracle),before=structuredClone(input);
  for(const keepExhausted of [false,true]){
    const probe=await compileWorkingOrderProbe({keepExhausted,traceStarts:true}),result=probe(input);
    const unobserved=(await compileWorkingOrderProbe({keepExhausted}))(input);
    assert.deepEqual(result.layers,unobserved.layers);
    assert.equal(result.phaseData.crossings,unobserved.phaseData.crossings);
    const events=result.phaseData.events;
    for(const start of events.filter(event=>event.event==='attempt-start'&&event.attempt>0)){
      const previous=events.filter(event=>event.event==='candidate'&&event.attempt===start.attempt-1);
      assert.deepEqual(start.layers,(keepExhausted?previous:previous.filter(event=>event.retained)).at(-1).layers);
    }
    if(!keepExhausted)assert.deepEqual(result.layers,orderLayers(input).layers);
  }
  assert.deepEqual(input,before);
});
test('working-order research provider retains strict geometry and source permutation invariance',async()=>{
  const Provider=await compileWorkingOrderProvider(),provider=new Provider();
  const input={nodes:[{id:'in',kind:'input',label:'in'},
    {id:'a',kind:'cell',label:'a',gateKind:'unknown',portDescriptors:[
      {pin:'A',rawPin:'A',direction:'input',side:'left'},
      {pin:'Z',rawPin:'Z',direction:'output',side:'right'}]},
    {id:'out',kind:'output',label:'out'}],edges:[
      {id:'ia',source:'in',target:'a',targetPin:'A',net:'n1'},
      {id:'ao',source:'a',sourcePin:'Z',target:'out',net:'n2'}]};
  const before=structuredClone(input),result=await provider.layout(input);
  assert.equal(result.validationMetrics.total,0);
  assert.deepEqual(input,before);
  const reverse=await provider.layout({...input,nodes:input.nodes.toReversed(),edges:input.edges.toReversed()});
  const geometry=graph=>({nodes:graph.nodes.map(({id,x,y})=>({id,x,y})).sort((a,b)=>a.id.localeCompare(b.id)),
    edges:graph.edges.map(({id,points})=>({id,points})).sort((a,b)=>a.id.localeCompare(b.id))});
  assert.deepEqual(geometry(reverse),geometry(result));
});
