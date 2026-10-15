import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanonicalGraph} from '../../src/layout/elk_native/ir.js';
import {structuralOrderingKey} from '../../tools/research/elk_phase_oracle/structural_ordering_key.mjs';
import {structuralOrderingKey as staticOrderingKey} from '../../src/layout/elk_native/structural_ordering_key.js';
import {CohesionResearchProvider} from '../../tools/research/elk_phase_oracle/probe_cohesion_provider.mjs';
test('factorial structural key keeps the unique D04 definition, excludes names and preserves source provenance',()=>{
  assert.equal(structuralOrderingKey,staticOrderingKey);
  const input={nodes:[{id:'a',displayName:'old',width:20,height:20,ports:[]}],edges:[]};
  const original=createCanonicalGraph(input),renamed=createCanonicalGraph({...input,nodes:[{...input.nodes[0],displayName:'new'}]});
  assert.notEqual(original.inputDigest,renamed.inputDigest);
  assert.equal(structuralOrderingKey(original),structuralOrderingKey(renamed));
  assert.notEqual(structuralOrderingKey(original),structuralOrderingKey(createCanonicalGraph({...input,nodes:[{...input.nodes[0],width:21}]})));
});
test('group/key research combinations preserve complete geometry under rename-only fixed measurements',async()=>{
  const graph={nodes:[{id:'root',kind:'cell',isFocusedRoot:true,label:'root',gateKind:'unknown',width:60,height:40,
    portDescriptors:[{pin:'A',rawPin:'A',direction:'input',side:'left'},{pin:'B',rawPin:'B',direction:'input',side:'left'},
      {pin:'Z',rawPin:'Z',direction:'output',side:'right'}]},
    ...['b','c'].map(id=>({id,kind:'input',label:id,width:40,height:30}))],edges:[
      {id:'br',source:'b',target:'root',targetPin:'A',net:'n1'},
      {id:'cr',source:'c',target:'root',targetPin:'B',net:'n2'}]};
  const byId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
  const before=structuredClone(graph),geometry=result=>({nodes:result.nodes.map(({id,x,y,width,height})=>({id,x,y,width,height})).toSorted(byId),
    edges:result.edges.map(({id,points})=>({id,points})).toSorted(byId),wires:result.wireRoutes});
  for(const physicalAnchors of [false,true])for(const layoutUnits of [false,true])for(const implicitPorts of [false,true]){
    const provider=new CohesionResearchProvider({groupSweep:true,structuralKey:true,implicitPorts,layoutUnits,physicalAnchors});
    const result=await provider.layout(graph),renamed=await provider.layout({...graph,nodes:graph.nodes.map(node=>({...node,label:`display:${node.id}`}))});
    assert.equal(result.validationMetrics.total,0);assert.equal(renamed.validationMetrics.total,0);
    assert.deepEqual(geometry(renamed),geometry(result));
    assert.notEqual(result.layoutMetrics.inputDigest,renamed.layoutMetrics.inputDigest);
    const permuted=await provider.layout({...graph,nodes:graph.nodes.toReversed(),edges:graph.edges.toReversed()});
    assert.equal(permuted.validationMetrics.total,0);assert.deepEqual(geometry(permuted),geometry(result));
  }
  assert.deepEqual(graph,before);
});
