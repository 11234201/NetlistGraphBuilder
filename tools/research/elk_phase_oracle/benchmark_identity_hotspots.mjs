import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {buildDependencies} from '../../../src/layout/elk_native/routing_dependencies.js';
import {buildDependencies as oldDependencies} from '../../../tests/reference/elk_native/p5_dependency_order_baseline.js';
import {optimizeRanks} from '../../../src/layout/elk_native/network_simplex.js';
import {optimizeRanks as oldRanks} from '../../../tests/reference/elk_native/p2_simplex_identity_baseline.js';
import {optimizeRanks as internedRanks} from '../../../tests/reference/elk_native/p2_simplex_interned_baseline.js';
import {optimizeRanks as cachedRanks} from '../../../tests/reference/elk_native/p2_simplex_cached_baseline.js';
import {optimizeRanks as indexedStateRanks} from '../../../tests/reference/elk_native/p2_simplex_indexed_state_baseline.js';

// Fixed bounded diagnostic sizes, not a replacement for the original47 gate.
const results=[];
function compare(label,original,candidate){
  const samples={original:[],candidate:[]};
  let pivotCount;
  for(let round=0;round<3;round++){
    const outputs={};
    for(const [name,run] of round%2?[['candidate',candidate],['original',original]]
      :[['original',original],['candidate',candidate]]){
      const cpu=process.cpuUsage(),start=performance.now();
      outputs[name]=run();
      const used=process.cpuUsage(cpu);
      samples[name].push({wallMs:performance.now()-start,cpuMs:(used.user+used.system)/1000});
    }
    assert.deepEqual(outputs.candidate,outputs.original,label);
    if(outputs.candidate.ranks){
      assert.deepEqual([...outputs.candidate.ranks],[...outputs.original.ranks]);
      pivotCount=outputs.candidate.evidence.pivotCount;
      assert.ok(pivotCount>0,'ranking benchmark must exercise actual pivots');
    }
  }
  results.push({label,exactResultEqual:true,pivotCount,samples});
}
for(const [count,prefixLength] of [[64,0],[128,1024],[256,0]]){
  const prefix='p'.repeat(prefixLength);
  const segments=Array.from({length:count},(_,index)=>({id:prefix+`segment${index}`,
    start:0,end:100,incoming:[0],outgoing:[100]}));
  compare(`p5-${count}-prefix${prefixLength}`,()=>oldDependencies(segments,0.2,10),
    ()=>buildDependencies(segments,0.2,10));
}
for(const count of [80,160,320]){
  const ids=Array.from({length:count},(_,index)=>'canonical/'.repeat(100)+`node${index}`);
  let seed=1947;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  const edges=[];
  for(let source=0;source<count;source++)for(let target=source+1;target<count;target++){
    if(source===0||random()%100<8)edges.push({id:`edge${edges.length}`,
      sourceNodeId:ids[source],targetNodeId:ids[target],weight:1+random()%5,minimumLength:1+random()%3});
  }
  const options={thoroughness:1,balanceLayers:true};
  compare(`p2-${count}`,()=>oldRanks(ids,edges,options),()=>optimizeRanks(ids,edges,options));
  compare(`p2-cache-${count}`,()=>internedRanks(ids,edges,options),()=>optimizeRanks(ids,edges,options));
  compare(`p2-state-${count}`,()=>cachedRanks(ids,edges,options),()=>optimizeRanks(ids,edges,options));
  compare(`p2-lookup-${count}`,()=>indexedStateRanks(ids,edges,options),()=>optimizeRanks(ids,edges,options));
}
console.log(JSON.stringify({node:process.version,scope:'bounded owning-boundary diagnostic; not47 acceptance',results},null,2));
