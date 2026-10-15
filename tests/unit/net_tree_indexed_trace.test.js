import assert from 'node:assert/strict';
import test from 'node:test';
import {buildNetTreeSegments} from '../../src/layout/netTreeRouter.js';
import {buildNetTreeSegments as baseline} from '../reference/elk_native/net_tree_before_indexed_trace.js';
import {buildWireRoutes} from '../../src/layout/wireRoutes.js';
import {buildWireRoutes as oldWireRoutes} from '../reference/elk_native/wire_routes_before_indexed_trace.js';

test('indexed physical-tree trace preserves complete output, ownership order and input',()=>{
  let state=5426;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
  for(let trial=0;trial<80;trial++){
    const segments=Array.from({length:24},(_,i)=>({start:{x:i*2.25,y:0},end:{x:(i+1)*2.25,y:0},
      logicalEdgeIds:new Set(['original',`s${i}`])}));
    segments.push({start:{x:0,y:0},end:{x:0,y:8},logicalEdgeIds:['cycle']},
      {start:{x:0,y:8},end:{x:54,y:8},logicalEdgeIds:['cycle']},
      {start:{x:54,y:8},end:{x:54,y:0},logicalEdgeIds:['cycle']});
    const edges=Array.from({length:40},(_,i)=>({id:'canonical/shared-prefix/'.repeat(12)+`${i%7===0?'é':'e'}${i%29}`,
      points:[{x:trial%4===0&&i%3===0?54:0,y:0},{x:trial%7===0&&i%9===0?999:(1+random()%24)*2.25,y:0}]}));
    const saved=structuredClone({segments,edges});
    assert.deepEqual(buildNetTreeSegments(segments,edges),baseline(segments,edges),`trial ${trial}`);
    assert.deepEqual({segments,edges},saved);
    assert.deepEqual(buildNetTreeSegments([...segments].reverse(),[...edges].reverse()),
      baseline([...segments].reverse(),[...edges].reverse()),'raw-index and tie behavior remains unchanged');
  }
});

test('physical-tree selection uses original segment ordinals after filtering unusable gaps',()=>{
  const valid=[0,10,20].map(x=>({start:{x,y:0},end:{x:x+10,y:0},logicalEdgeIds:['original']}));
  const invalid={start:{x:NaN,y:0},end:{x:0,y:0},logicalEdgeIds:['invalid']};
  const zero={start:{x:10,y:0},end:{x:10,y:0},logicalEdgeIds:['zero']};
  const unused={start:{x:90,y:0},end:{x:100,y:0},logicalEdgeIds:['unused']};
  const edges=[{id:'edge',points:[{x:0,y:0},{x:30,y:0}]}];
  for(const segments of [
    [invalid,...valid,unused],
    [valid[0],zero,valid[1],invalid,valid[2],unused],
    [unused,valid[2],invalid,valid[1],zero,valid[0]],
    [...valid,invalid,zero,unused]
  ]){
    const before=structuredClone(segments),result=buildNetTreeSegments(segments,edges);
    assert.equal(result.treeFallback,false);assert.equal(result.topology,'tree');
    assert.equal(result.componentCount,1);assert.equal(result.cycleCount,0);
    assert.equal(result.reachableTargetCount,1);assert.equal(result.segments.length,3);
    assert.deepEqual(result.segments.map(s=>s.start.x).sort((a,b)=>a-b),[0,10,20]);
    for(const segment of result.segments)assert.deepEqual(segment.logicalEdgeIds,['edge']);
    assert.deepEqual(segments,before);
  }
});

test('indexed trace retains full physical-route DTO for shared trunks and forests',()=>{
  for(let trial=0;trial<16;trial++){
    const edges=Array.from({length:40},(_,i)=>({id:`e${i}`,source:'s',target:`t${i}`,net:'same',
      label:'same',showLabel:i===0,points:[{x:0,y:0},{x:16+i*0.125,y:0},
        {x:16+i*0.125,y:i*2},{x:80,y:i*2}]}));
    if(trial%2)edges.push({id:'disconnected',source:'s',target:'missing',net:'same',
      points:[{x:1000,y:1000},{x:1100,y:1000}]});
    const saved=structuredClone(edges);
    assert.deepEqual(buildWireRoutes(edges),oldWireRoutes(edges));
    assert.deepEqual(buildWireRoutes([...edges].reverse()),oldWireRoutes([...edges].reverse()));
    assert.deepEqual(edges,saved);
  }
});
