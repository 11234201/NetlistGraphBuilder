import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanonicalGraph} from '../../src/layout/elk_native/ir.js';
import {orientGraph} from '../../src/layout/elk_native/p1_orientation.js';
import {orientGraph as reference} from '../reference/elk_native/p1_before_first_heap.js';

test('P1 ordinal heaps preserve every first-member decision and feedback edge',()=>{
  for(let seed=0;seed<100;seed++){
    const count=5+seed%19,nodes=Array.from({length:count},(_,i)=>({id:`n:${i}`,width:20,height:30,
      ports:[{id:`i:${i}`,side:'WEST',x:0,y:10},{id:`o:${i}`,side:'EAST',x:20,y:10}]}));
    const edges=Array.from({length:count*2},(_,i)=>({id:`e:${i}`,physicalNetId:`net:${i}`,sourcePortId:`o:${(i*7+seed)%count}`,
      targetPortId:`i:${(i*11+seed+1)%count}`,directionPriority:i%5}));
    const canonical=createCanonicalGraph({nodes,edges}),before=structuredClone(canonical);
    assert.deepEqual(orientGraph(canonical),reference(canonical));
    assert.deepEqual(orientGraph(createCanonicalGraph({nodes:nodes.toReversed(),edges:edges.toReversed()})),reference(canonical));
    assert.deepEqual(canonical,before);
  }
});
