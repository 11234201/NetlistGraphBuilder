import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const telemetry=['parseMs','graphMs','layoutMs','heapUsedMiB'];
const [before,after]=await Promise.all(process.argv.slice(2,4).map(async(file)=>{
  const value=JSON.parse(await readFile(file,'utf8'));
  for(const key of telemetry)delete value[key];
  return value;
}));
assert.deepEqual(after,before,'phase timings changed non-telemetry worker output');
console.log(JSON.stringify({nonTelemetryOutputEqual:true,ignoredTelemetry:telemetry,inputDigest:after.layoutMetrics?.inputDigest}));
