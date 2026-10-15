import assert from 'node:assert/strict';
import test from 'node:test';
import { optimizeRanks } from '../../src/layout/elk_native/network_simplex.js';
import { optimizeRanks as baseline } from '../reference/elk_native/p2_simplex_identity_baseline.js';
import { optimizeRanks as internedBaseline } from '../reference/elk_native/p2_simplex_interned_baseline.js';
import { optimizeRanks as cachedBaseline } from '../reference/elk_native/p2_simplex_cached_baseline.js';
import { optimizeRanks as indexedStateBaseline } from '../reference/elk_native/p2_simplex_indexed_state_baseline.js';

test('interned simplex identities retain full ranks, insertion order and pivot evidence',()=>{
  let seed=1947;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  let pivotCount=0,exhaustedCount=0;
  for(let trial=0;trial<40;trial++){
    const count=trial%2?80:12,prefix=trial%3?'canonical/long-prefix/'.repeat(40):'';
    const ids=Array.from({length:count},(_,index)=>prefix+`n${index}"\\`);
    const edges=[];
    for(let source=0;source<count;source++)for(let target=source+1;target<count;target++){
      if(source===0||trial%4===0&&target===source+1||random()%100<8)edges.push({id:prefix+`edge${edges.length}`,
        sourceNodeId:ids[source],targetNodeId:ids[target],weight:(1+random()%5)*(trial%3?1:0.1),minimumLength:1+random()%3});
    }
    const options={thoroughness:trial%3+1,balanceLayers:trial%2===0},previousProfile=[2,0,1];
    const expected=baseline(ids,edges,options,previousProfile);
    assert.deepEqual(internedBaseline(ids,edges,options,previousProfile),expected);
    assert.deepEqual(cachedBaseline(ids,edges,options,previousProfile),expected);
    assert.deepEqual(indexedStateBaseline(ids,edges,options,previousProfile),expected);
    pivotCount+=expected.evidence.pivotCount;
    exhaustedCount+=Number(!expected.evidence.optimal);
    for(const result of [optimizeRanks(ids,edges,options,previousProfile),
      optimizeRanks([...ids].reverse(),[...edges].reverse(),options,previousProfile)]){
      assert.deepEqual(result,expected,`trial ${trial}`);
      assert.deepEqual([...result.ranks],[...expected.ranks],`rank insertion order ${trial}`);
    }
  }
  assert.ok(pivotCount>0,'differential corpus must exercise actual pivots');
  assert.ok(exhaustedCount>0,'differential corpus must exercise iteration exhaustion');
  const controller=new AbortController();controller.abort();
  assert.throws(()=>optimizeRanks(['a'],[],{thoroughness:1},{},{signal:controller.signal}),/cancelled/);
});

test('interned simplex preserves peeled trees and public failure diagnostics',()=>{
  const ids=Array.from({length:80},(_,index)=>`n${index}`);
  const edges=ids.slice(1).map((target,index)=>({id:`e${index}`,sourceNodeId:ids[0],
    targetNodeId:target,weight:0.5,minimumLength:1+index%3}));
  assert.deepEqual(optimizeRanks(ids,edges,{thoroughness:1,balanceLayers:true}),
    baseline(ids,edges,{thoroughness:1,balanceLayers:true}));
  const cycle=[{id:'ab',sourceNodeId:'a',targetNodeId:'b',weight:1,minimumLength:1},
    {id:'ba',sourceNodeId:'b',targetNodeId:'a',weight:1,minimumLength:1}];
  for(const componentEdges of [cycle,[]]){
    const capture=(run)=>{try{run(['a','b'],componentEdges,{thoroughness:1});}
      catch(error){return {name:error.name,message:error.message,diagnostic:error.diagnostic};}};
    assert.deepEqual(capture(optimizeRanks),capture(baseline));
  }
});
