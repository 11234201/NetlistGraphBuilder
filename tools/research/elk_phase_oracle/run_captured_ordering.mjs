import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deserialize} from 'node:v8';
import {performance} from 'node:perf_hooks';
import {orderLayers} from '../../../src/layout/elk_native/p3_ordering.js';
import {freezeRecord} from '../../../src/layout/elk_native/protocol.js';
import {inputDigest} from '../../../src/layout/elk_native/input_digest.js';

const input=deserialize(await readFile(process.argv[2]));assert.equal(input.phase,'orderLayers');
if(process.argv.includes('--inspect')){
  const kinds=new Map();for(const edge of input.graph.edges)kinds.set(edge.segmentKind,(kinds.get(edge.segmentKind)??0)+1);
  console.log(JSON.stringify({nodes:input.graph.nodes.length,edges:input.graph.edges.length,
    ports:input.graph.nodes.reduce((sum,node)=>sum+node.ports.length,0),layers:input.graph.layers.length,
    segmentKinds:Object.fromEntries(kinds)}));process.exit(0);
}
freezeRecord(input.graph);
const started=performance.now(),cpu=process.cpuUsage();
const result=orderLayers(input.graph,input.options),used=process.cpuUsage(cpu);
console.log(JSON.stringify({scope:'complete actual P3 input; diagnostic, not47 acceptance',
  nodes:input.graph.nodes.length,edges:input.graph.edges.length,observe:input.options?.observe,
  wallMs:performance.now()-started,cpuMs:(used.user+used.system)/1000,
  resultDigest:inputDigest(JSON.stringify(result)),crossings:result.phaseData.crossings}));
