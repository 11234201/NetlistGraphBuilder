import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deserialize} from 'node:v8';
import {performance} from 'node:perf_hooks';
import {buildWireRoutes} from '../../../src/layout/wireRoutes.js';
import {buildWireRoutes as baseline} from '../../../tests/reference/elk_native/wire_routes_before_indexed_trace.js';

assert.ok(process.argv[2],'usage: compare_captured_wire_routes.mjs <complete-input.wire_routes.bin>');
const input=deserialize(await readFile(process.argv[2]));
assert.equal(input.phase,'buildWireRoutes');
const samples={},outputs={};
// One predeclared full-input pair: correctness evidence, not a statistical speed claim.
for(const [name,run] of [['original',baseline],['candidate',buildWireRoutes]]){
  const started=performance.now(),cpu=process.cpuUsage();
  outputs[name]=run(input.edges);
  const used=process.cpuUsage(cpu);
  samples[name]={wallMs:performance.now()-started,cpuMs:(used.user+used.system)/1000};
}
assert.deepEqual(outputs.candidate,outputs.original,'all physical geometry, lineage, topology and ordering');
console.log(JSON.stringify({scope:'one full actual phase-input pair; not47 acceptance',node:process.version,
  exactResultEqual:true,logicalEdges:input.edges.length,wireRoutes:outputs.candidate.length,
  segments:outputs.candidate.reduce((sum,route)=>sum+route.segments.length,0),samples}));
