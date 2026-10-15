import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortTieReplay} from '../../tools/research/elk_phase_oracle/replay_bk_port_ties.mjs';

test('source tie replay changes only within an owned port and never mutates the incident list',()=>{
  const oracle={producer:{sourceCommit:'pinned'},fixture:{caseId:'unit',inputDigest:'input'},snapshots:[
    {components:[{layers:[{nodeIds:['a']},{nodeIds:['b','c','d']}]}]},{boundary:'p4'}]};
  const trace={traceVersion:'1.0.0',caseId:'unit',sourceCommit:'pinned',inputDigest:'input',events:[
    {event:'bound-pick',direction:'RIGHTDOWN',freeIndex:0,isRoot:true,edge:{sourceIndex:0,sourcePortOrder:1,targetIndex:3,targetPortOrder:0}}]};
  const edges=[{id:'early-port',sourceNodeId:'a',sourcePortId:'a:0',targetNodeId:'b',targetPortId:'b:in'},
    {id:'first-tie',sourceNodeId:'a',sourcePortId:'a:1',targetNodeId:'c',targetPortId:'c:in'},
    {id:'source-choice',sourceNodeId:'a',sourcePortId:'a:1',targetNodeId:'d',targetPortId:'d:in'}];
  const context={ports:new Map([['a:0',{order:0}],['a:1',{order:1}],...['b','c','d'].map((id)=>[`${id}:in`,{order:0}])])};
  const before=structuredClone(edges),replay=createPortTieReplay(oracle,trace);
  assert.deepEqual(replay('a',true,edges,context,{horizontal:'RIGHT',vertical:'DOWN'}).map((edge)=>edge.id),
    ['early-port','source-choice','first-tie']);
  assert.deepEqual(edges,before);
  assert.equal(replay('a',false,edges,context,{horizontal:'RIGHT',vertical:'DOWN'}),edges);
  trace.events.push({...trace.events[0],edge:{sourceIndex:0,sourcePortOrder:1,targetIndex:2,targetPortOrder:0}});
  assert.throws(()=>createPortTieReplay(oracle,trace),/conflicting replay choices/);
});
