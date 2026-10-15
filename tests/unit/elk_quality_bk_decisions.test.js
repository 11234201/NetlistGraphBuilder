import test from 'node:test';
import assert from 'node:assert/strict';
import {compareBkDecisions,compareObservationSnapshots} from '../../tools/research/elk_phase_oracle/compare_bk_decisions.mjs';

function fixture(){
  const oracle={schemaVersion:'1.1.0',producer:{sourceCommit:'pinned',harnessRevision:'before'},fixture:{caseId:'unit',inputDigest:'input'},snapshots:[
    {boundary:'pre',components:[{layers:[{nodeIds:['a']},{nodeIds:['b']}],nodes:[{id:'a',ports:[{id:'a:o',order:0}]},
      {id:'b',ports:[{id:'b:i',order:0}]}],edges:[{id:'e',sourcePortId:'a:o',targetPortId:'b:i'}]}]},
    {boundary:'p4',phaseData:{events:[{event:'bk-candidates',candidates:['RIGHTDOWN','RIGHTUP','LEFTDOWN','LEFTUP'].map((direction)=>
      ({direction,root:['0:a','1:b']}))}]}}]};
  const edge={sourceIndex:0,sourcePortOrder:0,targetIndex:1,targetPortOrder:0};
  const trace={traceVersion:'1.0.0',caseId:'unit',sourceCommit:'pinned',inputDigest:'input',events:[
    {direction:'RIGHTDOWN',event:'bound-pick',freeIndex:1,blockIndex:1,isRoot:true,edge,blockY:0,straightened:false},
    {direction:'RIGHTDOWN',event:'move-result',freeIndex:1,blockIndex:1,edge,amount:5,blockY:10}]};
  const candidate={report:{candidates:[],events:[
    {direction:'RIGHTDOWN',event:'bound-pick',free:'b',block:'b',isRoot:true,edgeId:'e',blockY:0,straightened:false},
    {direction:'RIGHTDOWN',event:'move-result',free:'b',block:'b',edgeId:'e',available:5,blockY:10}]}};
  for(const direction of ['RIGHTDOWN','RIGHTUP','LEFTDOWN','LEFTUP'])for(const [index,free] of ['a','b'].entries()){
    trace.events.push({direction,event:'finish',freeIndex:index,blockIndex:index,edge:null,blockY:0});
    candidate.report.events.push({direction,event:'finish',free,block:free,blockY:0});
  }
  return {oracle,trace,candidate};
}
test('BK observation comparison permits only harness provenance and keeps every old graph/decision field authoritative',()=>{
  const {oracle}=fixture(),after=structuredClone(oracle);after.producer.harnessRevision='after';
  assert.equal(compareObservationSnapshots(oracle,after).equal,true);
  after.snapshots[0].components[0].edges[0].id='changed';
  assert.equal(compareObservationSnapshots(oracle,after).equal,false);
});
test('BK decision comparator resolves exact endpoints and flags; coordinate tolerance cannot conceal a semantic mismatch',()=>{
  const {oracle,trace,candidate}=fixture(),before=structuredClone({oracle,trace,candidate});
  assert.equal(compareBkDecisions(oracle,trace,candidate).allDecisionsMatch,true);
  assert.deepEqual({oracle,trace,candidate},before);
  candidate.report.events[1].blockY+=1e-8;
  assert.equal(compareBkDecisions(oracle,trace,candidate).allDecisionsMatch,true);
  candidate.report.events[0].straightened=true;
  assert.equal(compareBkDecisions(oracle,trace,candidate).reports[0].firstDifference.index,0);
  trace.events[0].edge.targetIndex=99;
  assert.throws(()=>compareBkDecisions(oracle,trace,candidate),/unknown BK node index/);
});
test('empty or partial BK sidecars cannot masquerade as a complete four-candidate match',()=>{
  const {oracle,trace,candidate}=fixture();
  trace.events=[];candidate.report.events=[];
  assert.throws(()=>compareBkDecisions(oracle,trace,candidate),/incomplete or duplicate upstream block-finish trace/);
});
