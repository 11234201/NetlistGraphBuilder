import assert from 'node:assert/strict';
import test from 'node:test';
import {createIdentityAblationResolver} from '../../tools/research/elk_phase_oracle/identity_ablation_resolver.mjs';

test('research identity ablation only substitutes explicit exact module URLs',()=>{
  const p2=new URL('../../src/layout/elk_native/network_simplex.js',import.meta.url).href;
  const p5=new URL('../../src/layout/elk_native/routing_dependencies.js',import.meta.url).href;
  const tree=new URL('../../src/layout/netTreeRouter.js',import.meta.url).href;
  for(const legacyP2 of [false,true])for(const legacyP5 of [false,true])for(const legacyTree of [false,true]){
    const resolve=createIdentityAblationResolver({legacyP2,legacyP5,legacyTree});
    for(const url of [p2,p5,tree,'file:///unrelated/src/layout/netTreeRouter.js','file:///unrelated/src/layout/elk_native/network_simplex.js','node:fs']){
      const result=resolve(url,{},(specifier)=>({url:specifier,format:'module'}));
      const expected=url===p2&&legacyP2?new URL('../reference/elk_native/p2_simplex_identity_baseline.js',import.meta.url).href
        :url===p5&&legacyP5?new URL('../reference/elk_native/p5_dependency_order_baseline.js',import.meta.url).href
        :url===tree&&legacyTree?new URL('../reference/elk_native/net_tree_before_indexed_trace.js',import.meta.url).href:url;
      assert.deepEqual(result,{url:expected,format:'module'});
    }
  }
});
