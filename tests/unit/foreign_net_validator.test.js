import assert from 'node:assert/strict';
import test from 'node:test';
import {validateLayoutGraph,finalizeLayoutGraph} from '../../src/layout/layoutValidator.js';
import {validateLayoutGraph as baseline,finalizeLayoutGraph as finalizeBaseline}
  from '../reference/elk_native/layout_validator_before_foreign_groups.js';
import {validateRoutes} from '../../src/layout/elk_native/validate_routes.js';
import {validateRoutes as routesBaseline} from '../reference/elk_native/validate_routes_before_foreign_groups.js';

test('foreign-net candidate narrowing preserves complete ordered layout diagnostics and input',()=>{
  let state=1471,overlapCount=0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
  for(let trial=0;trial<40;trial++){
    const nodes=[{id:'s',kind:'cell',x:0,y:0,width:10,height:10,inputPins:[],outputPins:[]},
      {id:'t',kind:'cell',x:240,y:0,width:10,height:10,inputPins:[],outputPins:[]}];
    const edges=Array.from({length:24},(_,i)=>{
      const y=random()%8+(i%7===0?1e-9:0),x=random()%4*4;
      const points=i%4===0?[{x:40,y:0},{x:40,y:80}]:[{x:20+x,y},{x:180-x,y}];
      if(i%5===0)points.reverse();
      return {id:`e${i}`,source:i%6===0?'missing':'s',target:'t',net:`n${i%3}`,points};
    });
    edges.push({...edges[0],id:'duplicate'}, {...edges[1],id:'nonfinite',points:[{x:NaN,y:1},{x:80,y:1}]});
    const graph={nodes,edges,width:260,height:100,wireRoutes:[]},saved=structuredClone(graph);
    overlapCount+=baseline(graph).filter((entry)=>entry.code==='net-overlap').length;
    for(const limit of [0,1,2,8,256,Infinity])for(const checkObstacles of [false,true]){
      const options={maxViolations:limit,checkObstacles,checkBounds:true};
      assert.deepEqual(validateLayoutGraph(graph,options),baseline(graph,options));
      assert.deepEqual(finalizeLayoutGraph(graph,options),finalizeBaseline(graph,options));
      const reversed={...graph,edges:[...edges].reverse(),nodes:[...nodes].reverse()};
      assert.deepEqual(validateLayoutGraph(reversed,options),baseline(reversed,options));
    }
    assert.deepEqual(graph,saved,'derived segment freezing must not freeze or mutate graph');
    assert.equal(Object.isFrozen(graph.edges[0].points[0]),false);
  }
  assert.ok(overlapCount>0,'differential test must include actual foreign overlaps');
});

const routeGraph=(owners,ys)=>({
  nodes:[{id:'s',x:0,y:0,width:10,height:10,ports:ys.map((y,i)=>
    ({id:`s${i}`,side:'EAST',x:10,y,anchor:{x:0,y:0}}))},
  {id:'t',x:240,y:0,width:10,height:10,ports:ys.map((y,i)=>
    ({id:`t${i}`,side:'WEST',x:0,y,anchor:{x:0,y:0}}))}],
  edges:owners.map((owner,i)=>({id:`e${i}`,physicalNetId:owner,sourcePortId:`s${i}`,targetPortId:`t${i}`,
    points:[{x:10,y:ys[i]},{x:240,y:ys[i]}]}))
});
const capture=(run,graph)=>{try{return {returnedSameGraph:run(graph)===graph};}
  catch(error){return {name:error.name,message:error.message,diagnostic:error.diagnostic};}};

test('P5 indexed foreign count preserves successful validation and first hard error',()=>{
  const cases=[routeGraph(['a','a','b'],[2,2,6]),routeGraph(['a','a','b'],[2,2,3]),
    routeGraph(['a','b'],[2,4]),routeGraph(['a','b'],[2,4-1e-9])];
  const corrupt=routeGraph(['a'],[2]);corrupt.edges[0].points[1].y+=1;cases.push(corrupt);
  for(const graph of cases){
    const before=structuredClone(graph);
    assert.deepEqual(capture(validateRoutes,graph),capture(routesBaseline,graph));
    assert.deepEqual(graph,before);
  }
  assert.match(capture(validateRoutes,cases[1]).message,/foreign-wire-overlap/);
  assert.equal(capture(validateRoutes,cases[0]).returnedSameGraph,true);
});
