import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {RouteSegmentIndex,segmentBox} from '../../../src/layout/spatialIndex.js';
import {RouteSegmentIndex as BaselineIndex} from '../../../tests/reference/elk_native/spatial_index_before_foreign_groups.js';

// Fixed, predeclared sizes. Includes construction and lazy cache initialization;
// does not replace the whole-worker original47 correctness/performance gate.
const results=[];
for(const count of [128,512,2048])for(const shape of ['shared','independent','mixed']){
  const segments=Array.from({length:count},(_,i)=>Object.freeze({id:`s${i}`,
    netGroupKey:shape==='shared'?'a':shape==='independent'?`n${i}`:`n${i%8}`,
    start:{x:0,y:i%8},end:{x:1000,y:i%8}}));
  const queries=Array.from({length:100},(_,i)=>segments[(i*17)%count]);
  const run=(modern)=>{
    const index=new (modern?RouteSegmentIndex:BaselineIndex)(segments);
    return queries.map((segment)=>{
      const owner=segment.netGroupKey,box=segmentBox(segment,2);
      const candidates=modern?index.queryHorizontalForeignSegment(segment,2,owner)
        :index.queryHorizontalSegment(segment,2).filter((other)=>other.netGroupKey!==owner);
      const count=modern?index.countForeignBox(box,owner,()=>true,3)
        :index.countBox(box,(other)=>other.netGroupKey!==owner,3);
      return {candidateIds:candidates.map((other)=>other.id),count};
    });
  };
  const samples={original:[],candidate:[]};
  for(let round=0;round<3;round++){
    const outputs={};
    for(const name of round%2?['candidate','original']:['original','candidate']){
      const start=performance.now(),cpu=process.cpuUsage();
      outputs[name]=run(name==='candidate');
      const used=process.cpuUsage(cpu);
      samples[name].push({wallMs:performance.now()-start,cpuMs:(used.user+used.system)/1000});
    }
    assert.deepEqual(outputs.candidate,outputs.original);
  }
  results.push({label:`foreign-index-${shape}-${count}`,exactResultEqual:true,samples});
}
console.log(JSON.stringify({node:process.version,scope:'fixed owning-boundary diagnostic; not47 acceptance',results},null,2));
