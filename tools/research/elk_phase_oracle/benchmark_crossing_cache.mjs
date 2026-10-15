import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {crossingContext,countCrossings} from '../../../src/layout/elk_native/crossing_counter.js';
import {crossingContext as oldContext,countCrossings as oldCount} from '../../../tests/reference/elk_native/crossing_counter_baseline.js';
const results=[];
for(const sharedPorts of [false,true]){
  const nodes=[],edges=[],layers=[];
  for(let layer=0;layer<4;layer++){
    const nodeIds=[];
    for(let index=0;index<32;index++){
      const id=`l${layer}n${index}`;nodeIds.push(id);nodes.push({id,layer,ports:[]});
    }
    layers.push({nodeIds});
  }
  const byId=new Map(nodes.map((node)=>[node.id,node]));
  for(let layer=0;layer<3;layer++)for(let source=0;source<32;source++)for(let target=0;target<32;target++){
    if((source*17+target*31+layer)%11>=2)continue;
    const id=`e${edges.length}`,sourceNodeId=layers[layer].nodeIds[source],targetNodeId=layers[layer+1].nodeIds[target];
    const sourcePortId=sharedPorts?`${sourceNodeId}:out`:`${id}:out`,targetPortId=sharedPorts?`${targetNodeId}:in`:`${id}:in`;
    for(const [nodeId,portId,side] of [[sourceNodeId,sourcePortId,'EAST'],[targetNodeId,targetPortId,'WEST']]){
      const ports=byId.get(nodeId).ports;if(!ports.some((port)=>port.id===portId))ports.push({id:portId,side});
    }
    edges.push(Object.freeze({id,sourceNodeId,targetNodeId,sourcePortId,targetPortId,segmentKind:'inter_layer'}));
  }
  const graph={nodes,edges,layers},samples={original:[],candidate:[]};
  for(let round=0;round<3;round++){
    const outputs={};
    for(const [name,create,count] of round%2?[['candidate',crossingContext,countCrossings],['original',oldContext,oldCount]]
      :[['original',oldContext,oldCount],['candidate',crossingContext,countCrossings]]){
      const cpu=process.cpuUsage(),start=performance.now(),context=create(graph);
      outputs[name]=Array.from({length:100},(_,index)=>count(graph,layers.map(({nodeIds})=>{
        const offset=index%nodeIds.length;return [...nodeIds.slice(offset),...nodeIds.slice(0,offset)];
      }),context));
      const used=process.cpuUsage(cpu);
      samples[name].push({wallMs:performance.now()-start,cpuMs:(used.user+used.system)/1000});
    }
    assert.deepEqual(outputs.candidate,outputs.original);
  }
  results.push({label:`p3-128-${sharedPorts?'shared':'independent'}-ports-100-scores`,exactResultEqual:true,samples});
}
console.log(JSON.stringify({node:process.version,scope:'fixed reused-context counter diagnostic',results},null,2));
