import assert from 'node:assert/strict';
import test from 'node:test';
import {RouteSegmentIndex,segmentBox} from '../../src/layout/spatialIndex.js';
import {RouteSegmentIndex as BaselineIndex} from '../reference/elk_native/spatial_index_before_foreign_groups.js';
import {parallelSegmentsOverlap} from '../../src/layout/orthogonalRouting.js';

const line=(owner,x,y,length=64,vertical=false,frozen=true)=>{
  const value={netGroupKey:owner,start:{x,y},end:vertical?{x,y:y+length}:{x:x+length,y}};
  return frozen?Object.freeze(value):value;
};

function compareQueries(index,baseline,queries){
  for(const segment of queries)for(const padding of [-2,0,2,200,100000]){
    for(const owner of ['a','b','c',undefined,0,'0',NaN]){
      const foreign=(other)=>other.netGroupKey!==owner;
      assert.deepEqual(index.queryHorizontalForeignSegment(segment,padding,owner),
        baseline.queryHorizontalSegment(segment,padding).filter(foreign));
      assert.deepEqual(index.queryVerticalForeignSegment(segment,padding,owner),
        baseline.queryVerticalSegment(segment,padding).filter(foreign));
      const box=segmentBox(segment,padding);
      for(const maximum of [-1,0,1,3,Infinity]){
        const predicate=(other)=>other.start.x%3===0;
        assert.equal(index.countForeignBox(box,owner,predicate,maximum),
          baseline.countBox(box,(other)=>foreign(other)&&predicate(other),maximum));
      }
      assert.deepEqual(index.queryBox(box),baseline.queryBox(box),'ordinary query stays unchanged');
    }
  }
}

test('foreign-net groups preserve ordered candidates, duplicates and bounded counts',()=>{
  const owners=['a','b','a','c',undefined,0,'0',NaN];
  const segments=Array.from({length:96},(_,i)=>line(owners[i%owners.length],(i%6)*3,
    Math.floor(i/6)*16,i%5===0?0:64,i%3===0,i%4!==0));
  segments.push(segments[0],segments[0],line('a',0,NaN));
  const index=new RouteSegmentIndex(segments,16),baseline=new BaselineIndex(segments,16);
  const queries=[line('q',0,0,240),line('q',9,100,240,true),line('q',-10,-40,64)];
  compareQueries(index,baseline,queries);
  for(const value of [line('a',0,0),line('b',3,1),line('a',0,0,100,true)]){
    index.push(value);baseline.push(value);compareQueries(index,baseline,queries);
  }
  index.removeOwner('a');baseline.removeOwner('a');compareQueries(index,baseline,queries);
  index.replaceOwner('a',[line('a',0,0)]);baseline.replaceOwner('a',[line('a',0,0)]);
  compareQueries(index,baseline,queries);
  index.compact();baseline.compact();compareQueries(index,baseline,queries);
  index.rebuild(segments);baseline.rebuild(segments);compareQueries(index,baseline,queries);
});

test('mutable and frozen accessor owners are never cached as static ownership',()=>{
  let owner='a';
  const mutable=line(owner,0,0,64,false,false);
  const accessor=Object.freeze({get netGroupKey(){return owner;},start:{x:0,y:0},end:{x:64,y:0}});
  const segments=[line('a',0,0),mutable,accessor,line('b',3,0)];
  const index=new RouteSegmentIndex(segments),baseline=new BaselineIndex(segments);
  compareQueries(index,baseline,[line('q',0,0)]);
  owner='b';mutable.netGroupKey='b';
  compareQueries(index,baseline,[line('q',0,0)]);
});

test('near-axis reversed duplicate geometry is retained at the strict 2px boundary',()=>{
  const delta=1e-9;
  const first=Object.freeze({netGroupKey:'a',start:{x:10,y:10},end:{x:100,y:10+delta}});
  const reverse=Object.freeze({netGroupKey:'a',start:first.end,end:first.start});
  const foreign=line('b',10,12+delta/2,90);
  assert.equal(parallelSegmentsOverlap(first,foreign),false);
  assert.equal(parallelSegmentsOverlap(reverse,foreign),true);
  const index=new RouteSegmentIndex([first,reverse]);
  assert.deepEqual(index.queryHorizontalForeignSegment(foreign,2,'b'),[first,reverse]);
  assert.equal(index.countForeignBox(segmentBox(foreign,2),'b',
    (other)=>parallelSegmentsOverlap(other,foreign),1),1);
  assert.equal(index.length,2,'no physical geometry deduplication');
});
