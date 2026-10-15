import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deserialize} from 'node:v8';
import {performance} from 'node:perf_hooks';
import {orderLayers} from '../../../src/layout/elk_native/p3_ordering.js';
import {orderLayers as reference} from '../../../tests/reference/elk_native/p3_before_h08_performance.js';
import {freezeRecord} from '../../../src/layout/elk_native/protocol.js';
import {inputDigest} from '../../../src/layout/elk_native/input_digest.js';
const input=deserialize(await readFile(process.argv[2]));assert.equal(input.phase,'orderLayers');freezeRecord(input.graph);
const run=fn=>{const start=performance.now(),cpu=process.cpuUsage(),result=fn(input.graph,input.options),used=process.cpuUsage(cpu);
  return {result,wallMs:performance.now()-start,cpuMs:(used.user+used.system)/1000};};
const old=run(reference),current=run(orderLayers);assert.deepEqual(current.result,old.result);
console.log(JSON.stringify({scope:'one fixed full actual P3 pair, not47 gate or statistical speed claim',
  nodes:input.graph.nodes.length,edges:input.graph.edges.length,equal:true,
  old:{wallMs:old.wallMs,cpuMs:old.cpuMs},current:{wallMs:current.wallMs,cpuMs:current.cpuMs},
  resultDigest:inputDigest(JSON.stringify(current.result))}));
