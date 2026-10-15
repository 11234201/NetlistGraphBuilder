import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDependencies } from '../../src/layout/elk_native/routing_dependencies.js';
import { buildDependencies as baseline } from '../reference/elk_native/p5_dependency_order_baseline.js';

test('compact candidate identities preserve exact legacy order, counts and focus behavior',()=>{
  const names=['a','a"','a\\','a\n','a\u0000','a,','a]','á','中','😀','\ud800','10','2'];
  let seed=913;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let trial=0;trial<100;trial++){
    const segments=names.map((name,index)=>{
      const incoming=[...new Set([random()%80,random()%80])].sort((a,b)=>a-b);
      const outgoing=[...new Set([random()%80,random()%80])].sort((a,b)=>a-b);
      return {id:(trial%2?'shared-prefix/'.repeat(200):'')+name,index,incoming,outgoing,
        start:Math.min(...incoming,...outgoing),end:Math.max(...incoming,...outgoing)};
    });
    const critical=trial%5,spacing=trial%23;
    for(const focusIds of [undefined,new Set(),new Set([segments[0].id,segments[4].id])]){
      const options={focusIds};
      const expected=baseline(segments,critical,spacing,options);
      assert.deepEqual(buildDependencies(segments,critical,spacing,options),expected);
      assert.deepEqual(buildDependencies([...segments].reverse(),critical,spacing,options),expected);
    }
  }
});
