import { readFile } from 'node:fs/promises';
const lines=(await readFile(process.argv[2],'utf8')).split('\n');
for(let index=0;index<lines.length;index++){
  if(!/^[a-z]+_\d+:$/.test(lines[index]))continue;
  const failure=JSON.parse(lines[index+1]);
  console.log(JSON.stringify({caseId:lines[index].slice(0,-1),reason:failure.reason,
    elapsedMs:failure.elapsedMs,violationCodes:failure.metrics?.violationCodes,
    samples:failure.metrics?.violationSamples?.slice(0,3)}));
}
