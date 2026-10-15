import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deserialize} from 'node:v8';
import {performance} from 'node:perf_hooks';
import {validateLayoutGraph} from '../../../src/layout/layoutValidator.js';
import {validateLayoutGraph as baseline} from '../../../tests/reference/elk_native/layout_validator_before_foreign_groups.js';

const path=process.argv[2];
assert.ok(path,'usage: benchmark_captured_validator.mjs <complete-input.validation.bin> [--candidate-only]');
const input=deserialize(await readFile(path));
assert.equal(input.phase,'validateLayoutGraph');
const samples={original:[],candidate:[]};
let expected;
const candidateOnly=process.argv.includes('--candidate-only');
for(let round=0;round<(candidateOnly?1:3);round++){
  const outputs={};
  for(const name of candidateOnly?['candidate']:round%2?['candidate','original']:['original','candidate']){
    const started=performance.now(),cpu=process.cpuUsage();
    outputs[name]=(name==='candidate'?validateLayoutGraph:baseline)(input.graph,input.options);
    const used=process.cpuUsage(cpu);
    samples[name].push({wallMs:performance.now()-started,cpuMs:(used.user+used.system)/1000});
  }
  if(!candidateOnly){
    assert.deepEqual(outputs.candidate,outputs.original,'complete ordered validation diagnostics');
    if(expected)assert.deepEqual(outputs.candidate,expected);
  }
  expected=outputs.candidate;
}
console.log(JSON.stringify({node:process.version,path,scope:'complete phase-input diagnostic; not47 acceptance',
  nodes:input.graph.nodes?.length,edges:input.graph.edges?.length,wireRoutes:input.graph.wireRoutes?.length,
  exactResultEqual:candidateOnly?null:true,violationCount:expected.length,samples},null,2));
