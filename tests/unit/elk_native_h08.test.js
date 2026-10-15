import assert from 'node:assert/strict';
import test from 'node:test';
import {layoutGraph} from '../../src/layout/elk_native/index.js';
import {normalizeH08Profile} from '../../src/layout/elk_native/h08_profile.js';
import {compileCohesionModule,CohesionResearchProvider} from '../../tools/research/elk_phase_oracle/probe_cohesion_provider.mjs';
import {NativeLayeredLayoutProvider} from '../../src/layout/elk_native_layout_provider.js';
import {layoutGraph as fixedH08} from '../../src/layout/elk_native/h08.js';
import {ORDER_GROUP_POLICY} from '../../src/layout/elk_native/order_group_contract.js';

const input=()=>({nodes:['a','b','r'].map(id=>({id,width:40,height:30,ports:[
  {id:`${id}:i`,side:'WEST',x:0,y:10},{id:`${id}:j`,side:'WEST',x:0,y:20},
  {id:`${id}:o`,side:'EAST',x:40,y:10}]})),
  edges:['a','b'].map(id=>({id,sourcePortId:`${id}:o`,targetPortId:id==='a'?'r:i':'r:j',physicalNetId:id}))});
const groups=[{nodeId:'a',membershipKey:'tree'},{nodeId:'b',membershipKey:'tree'}];
const complete=graph=>({...graph,phaseData:{components:graph.phaseData.components,placements:graph.phaseData.placements}});

test('clone-importable H08 entry cannot silently disable its fixed semantic profile',async()=>{
  assert.deepEqual(ORDER_GROUP_POLICY,{groupBandTolerance:2,extraCandidateLimit:1});
  assert.ok(Object.isFrozen(ORDER_GROUP_POLICY));
  const result=await fixedH08(input(),{profile:'baseline'});
  assert.equal(result.phaseData.profile.id,'h08');assert.equal(result.phaseData.profile.version,'1.0.0');
});

test('fixed static H08 entry matches every research phase and complete geometry',async()=>{
  const graph=input(),before=structuredClone(graph),oldPhases=[],newPhases=[];
  const compiled=await compileCohesionModule(groups,{groupSweep:true,structuralKey:true,
    implicitPorts:true,layoutUnits:true,physicalAnchors:true});
  const reference=await (await import(compiled.layoutModule)).layoutGraph(graph,{onPhase:g=>oldPhases.push(g)});
  const result=await layoutGraph(graph,{profile:'h08',orderGroups:groups,onPhase:g=>newPhases.push(g)});
  assert.deepEqual(newPhases,oldPhases);assert.deepEqual(complete(result),reference);
  assert.equal(result.phaseData.profile.id,'h08');assert.ok(Object.isFrozen(result.phaseData.profile.groups));
  assert.deepEqual(graph,before);
  const permuted=await layoutGraph({...graph,nodes:graph.nodes.toReversed(),edges:graph.edges.toReversed()},
    {profile:'h08',orderGroups:groups.toReversed()});
  assert.deepEqual(permuted,result);
});

test('H08 snapshots hint identity before async observers and rejects unsupported inputs explicitly',async()=>{
  const graph=input(),hints=structuredClone(groups),expected=await layoutGraph(graph,{profile:'h08',orderGroups:hints});
  let changed=false;
  const actual=await layoutGraph(graph,{profile:'h08',orderGroups:hints,onPhase:async()=>{
    if(changed)return;changed=true;hints[0].membershipKey='changed';hints.length=0;graph.nodes.length=0;
    await Promise.resolve();
  }});
  assert.deepEqual(actual,expected);
  assert.deepEqual(normalizeH08Profile(input(),groups),normalizeH08Profile(input(),groups.toReversed()));
  assert.throws(()=>normalizeH08Profile(input(),[groups[0],groups[0]]),/invalid-order-group/);
  await assert.rejects(layoutGraph(input(),{profile:'unknown'}),/unsupported-profile/);
  await assert.rejects(layoutGraph(input(),{profile:'h08',signal:AbortSignal.abort()}),{name:'AbortError'});
});

test('static H08 public adapter matches research public graph without private query state',async()=>{
  const graph={nodes:[{id:'root',kind:'cell',isFocusedRoot:true,label:'root',gateKind:'unknown',width:60,height:40,
    portDescriptors:[{pin:'A',rawPin:'A',direction:'input',side:'left'},{pin:'B',rawPin:'B',direction:'input',side:'left'}]},
    ...['a','b'].map(id=>({id,kind:'input',label:id,width:40,height:30}))],edges:['a','b'].map((id,index)=>
      ({id,source:id,target:'root',targetPin:index?'B':'A',net:id}))};
  const research=new CohesionResearchProvider({groupSweep:true,structuralKey:true,implicitPorts:true,layoutUnits:true,physicalAnchors:true});
  const expected=await research.layout(graph),result=await new NativeLayeredLayoutProvider({profile:'h08'}).layout(graph);
  const normalized=({layoutMetrics,...rest})=>({...rest,layoutMetrics:{contractVersion:layoutMetrics.contractVersion,
    inputDigest:layoutMetrics.inputDigest,components:layoutMetrics.components,placements:layoutMetrics.placements}});
  assert.deepEqual(normalized(result),normalized(expected));
});
