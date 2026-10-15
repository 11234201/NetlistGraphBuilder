import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deserialize} from 'node:v8';
import {performance} from 'node:perf_hooks';
import {buildWireRoutes} from '../../../src/layout/wireRoutes.js';

assert.ok(process.argv[2],'usage: run_captured_wire_routes.mjs <complete-input.wire_routes.bin>');
const input=deserialize(await readFile(process.argv[2]));
assert.equal(input.phase,'buildWireRoutes');
const started=performance.now(),cpu=process.cpuUsage();
const routes=buildWireRoutes(input.edges);
const used=process.cpuUsage(cpu);
console.log(JSON.stringify({scope:'complete actual phase-input diagnosis; not47 acceptance',
  node:process.version,logicalEdges:input.edges.length,wireRoutes:routes.length,
  segments:routes.reduce((sum,route)=>sum+route.segments.length,0),
  wallMs:performance.now()-started,cpuMs:(used.user+used.system)/1000}));
