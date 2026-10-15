import assert from 'node:assert/strict';
import test from 'node:test';
import {crossingContext,countCrossings} from '../../src/layout/elk_native/crossing_counter.js';
import {countCrossings as reference} from '../reference/elk_native/crossing_counter_before_zero_score.js';
import {freezeRecord} from '../../src/layout/elk_native/protocol.js';

function fixture(){
  return freezeRecord({nodes:['a','b','c','d'].map((id,index)=>({id,layer:index<2?0:1,
    ports:[{id:`${id}:p`,side:index<2?'EAST':'WEST'}]})),
    edges:[{id:'e0',sourceNodeId:'a',targetNodeId:'d',sourcePortId:'a:p',targetPortId:'d:p',segmentKind:'inter_layer'},
      {id:'e1',sourceNodeId:'b',targetNodeId:'c',sourcePortId:'b:p',targetPortId:'c:p',segmentKind:'inter_layer'}],
    layers:[{nodeIds:['a','b']},{nodeIds:['c','d']}]});
}
test('zero-score shortcut preserves crossings and falls back after scratch incidence mutations',()=>{
  for(const mutation of ['none','append','replace','array','node']){
    const graph=fixture(),context=crossingContext(graph);
    const edge=Object.freeze({id:'in',sourceNodeId:'a',targetNodeId:'b',sourcePortId:'a:p',targetPortId:'b:p',segmentKind:'in_layer'});
    if(mutation==='append')for(const id of ['a:p','b:p'])context.incident.get(id).push(edge);
    if(mutation==='replace')context.incident.get('a:p')[0]=edge;
    if(mutation==='array')context.incident.set('a:p',[edge]);
    if(mutation==='node')context.nodes.set('a',{...graph.nodes[0],ports:[...graph.nodes[0].ports]});
    for(const layers of [graph.layers.map(l=>l.nodeIds),[['b','a'],['d','c']]])
      assert.equal(countCrossings(graph,layers,context),reference(graph,layers,context));
  }
  const graph=fixture(),context=crossingContext(graph);
  assert.throws(()=>countCrossings(graph,[['missing']],context),TypeError);
});
test('frozen kind accessors remain dynamic and cannot qualify for zero-score shortcut',()=>{
  const base=fixture();let kind='inter_layer';
  const graph={...base,edges:[Object.freeze({...base.edges[0],get segmentKind(){return kind;}}),base.edges[1]]};
  const context=crossingContext(graph);
  for(const value of ['inter_layer','in_layer','inter_layer']){
    kind=value;assert.equal(countCrossings(graph,undefined,context),reference(graph,undefined,context));
  }
});
