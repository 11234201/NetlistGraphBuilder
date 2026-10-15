import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {inputDigest} from '../../../src/layout/elk_native/input_digest.js';
import {inputDigest as baseline} from '../../../tests/reference/elk_native/input_digest_baseline.js';
const results=[];
for(const bytes of [65536,1048576,8388608]){
  const text='canonical-node-id/'.repeat(Math.ceil(bytes/18)).slice(0,bytes);
  const expected=`sha256:${createHash('sha256').update(text).digest('hex')}`;
  const samples={original:[],candidate:[]};
  for(let round=0;round<3;round++)for(const [name,run] of round%2
    ?[['candidate',inputDigest],['original',baseline]]:[['original',baseline],['candidate',inputDigest]]){
    const start=performance.now(),cpu=process.cpuUsage();
    const result=run(text),used=process.cpuUsage(cpu);
    samples[name].push({wallMs:performance.now()-start,cpuMs:(used.user+used.system)/1000});
    assert.equal(result,expected);
  }
  results.push({label:`sha256-${bytes}`,exactResultEqual:true,samples});
}
console.log(JSON.stringify({node:process.version,scope:'portable SHA256 fixed-input diagnostic',results},null,2));
