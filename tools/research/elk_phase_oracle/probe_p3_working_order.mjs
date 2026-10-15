import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {properInputFromOracle} from './upstream_proper_input.mjs';
import {orderLayers} from '../../../src/layout/elk_native/p3_ordering.js';
import {createQualityBaseline,sha256} from './quality_baseline.mjs';

async function workingModuleUrl({keepExhausted=true,traceStarts=false}={}){
  const location=new URL('../../../src/layout/elk_native/p3_ordering.js',import.meta.url);
  let source=await readFile(location,'utf8');
  const replacements=[['if (!improves) { current = retained; break; }','if (!improves) { break; }'],
    ['    current = copyLayers(retained);','    // Research control: keep the exhausted working order for the next attempt.']];
  for(const [before,after] of keepExhausted?replacements:[]){
    assert.equal(source.split(before).length,2,'missing or ambiguous source anchor');
    source=source.replace(before,after);
  }
  if(traceStarts){
    const anchor="    const model = attempt % 2 ? 'layer_total' : 'node_relative';";
    assert.equal(source.split(anchor).length,2);
    source=source.replace(anchor,"    if (observe) events.push({event:'attempt-start',attempt,layers:copyLayers(current)});\n"+anchor);
  }
  source=source.replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,location).href}'`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
export async function compileWorkingOrderProbe(options){
  return (await import(await workingModuleUrl(options))).orderLayers;
}
async function workingIndexUrl(){
  const indexLocation=new URL('../../../src/layout/elk_native/index.js',import.meta.url);
  let index=await readFile(indexLocation,'utf8');
  const anchor="import { orderLayers } from './p3_ordering.js';";
  assert.equal(index.split(anchor).length,2);
  index=index.replace(anchor,`import { orderLayers } from '${await workingModuleUrl()}';`)
    .replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,indexLocation).href}'`);
  const indexUrl=`data:text/javascript;base64,${Buffer.from(index).toString('base64')}`;
  return indexUrl;
}
export async function compileWorkingOrderLayout(){
  return (await import(await workingIndexUrl())).layoutGraph;
}
export async function compileWorkingOrderProvider(){
  const indexUrl=await workingIndexUrl();
  const adapterLocation=new URL('../../../src/layout/elk_native_layout_provider.js',import.meta.url);
  let adapter=await readFile(adapterLocation,'utf8');
  const adapterAnchor="from './elk_native/index.js'";
  assert.equal(adapter.split(adapterAnchor).length,2);
  adapter=adapter.replace(adapterAnchor,`from '${indexUrl}'`)
    .replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,adapterLocation).href}'`);
  return (await import(`data:text/javascript;base64,${Buffer.from(adapter).toString('base64')}`)).NativeLayeredLayoutProvider;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [file,output]=process.argv.slice(2);
  if(!output)throw Error('usage: probe_p3_working_order.mjs <oracle> <output-dir>');
  await mkdir(output,{recursive:true});
  const root=fileURLToPath(new URL('../../../',import.meta.url)),before=await createQualityBaseline(root,'p3_working');
  const bytes=await readFile(file),oracle=JSON.parse(bytes.toString('utf8')),input=properInputFromOracle(oracle),original=JSON.stringify(input);
  const probe=await compileWorkingOrderProbe(),baseline=orderLayers(input),trial=probe(input);
  assert.equal(JSON.stringify(input),original);
  const report={caseId:oracle.fixture.caseId,oracleDigest:sha256(bytes),inputDigest:input.inputDigest,
    baseline:{crossings:baseline.phaseData.crossings,layers:baseline.layers,events:baseline.phaseData.events},
    trial:{crossings:trial.phaseData.crossings,layers:trial.layers,events:trial.phaseData.events}};
  await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
  const after=await createQualityBaseline(root,'p3_working_after');
  await writeFile(`${output}/baseline.before.json`,JSON.stringify(before,null,2));
  await writeFile(`${output}/baseline.after.json`,JSON.stringify(after,null,2));
  assert.equal(before.fileSetDigest,after.fileSetDigest);
  console.log(JSON.stringify({caseId:report.caseId,baseline:report.baseline.crossings,trial:report.trial.crossings}));
}
