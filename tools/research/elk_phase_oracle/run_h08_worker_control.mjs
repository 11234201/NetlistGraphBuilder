import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createQualityBaseline} from './quality_baseline.mjs';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('usage: run_h08_worker_control.mjs <mapped.v> <output-directory>');
const directory=resolve(output);await mkdir(directory,{recursive:true});
const root=fileURLToPath(new URL('../../../',import.meta.url));
const before=await createQualityBaseline(root,'h08_worker_control');
await writeFile(resolve(directory,'baseline.before.json'),JSON.stringify(before,null,2));
const results=[];
for(const [name,enabled] of [['research','0'],['static','1']]){
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./cohesion_mapped_worker.mjs',import.meta.url)),
    resolve(input),'--no-collapse','--hard'],{encoding:'utf8',timeout:45000,maxBuffer:32*1024*1024,
    env:{...process.env,C01_PHYSICAL_ANCHORS:'1',C01_STATIC_H08:enabled,MAPPED_CASE_PROVIDER:'h08-control'}});
  await writeFile(resolve(directory,`${name}.stdout.json`),result.stdout??'');
  await writeFile(resolve(directory,`${name}.stderr.log`),result.stderr??'');
  const parsed=result.status===0?JSON.parse(result.stdout.trim()):null;
  const summary={name,status:result.status,signal:result.signal,error:result.error?.code??null,
    layoutMs:parsed?.layoutMs??null,violations:parsed?.violations??null,layoutStatus:parsed?.layoutStatus??null};
  results.push(summary);console.log(JSON.stringify(summary));
}
const after=await createQualityBaseline(root,'h08_worker_control_after');
await writeFile(resolve(directory,'baseline.after.json'),JSON.stringify(after,null,2));
if(before.fileSetDigest!==after.fileSetDigest)throw Error('source changed during control');
await writeFile(resolve(directory,'results.json'),JSON.stringify({timeoutMs:45000,results},null,2));
if(results.some(result=>result.status!==0||result.violations!==0||result.layoutStatus!=='routed'))process.exitCode=1;
