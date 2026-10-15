import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const sha256=(bytes)=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const compare=(a,b)=>a<b?-1:a>b?1:0;
const defaultRoots=['src','vendor','examples','tests/fixtures','tests/helpers','tests/reference','tests/unit',
  'tools/research/elk_phase_oracle','tools/test-one-mapped-case.mjs','tools/test-mapped-cases.mjs',
  'package.json','index.html','styles.css','docs/design/elk-native-phase-contracts.md',
  'docs/design/elk-native-phase-snapshot.schema.json'];

export async function collectFileHashes(repoRoot,roots=defaultRoots){
  const files=[];
  async function visit(relative){
    const absolute=path.join(repoRoot,relative),info=await stat(absolute);
    if(info.isDirectory()){
      for(const entry of (await readdir(absolute)).sort(compare))await visit(`${relative}/${entry}`);
    }else if(info.isFile()){
      const bytes=await readFile(absolute);
      files.push({path:relative.replaceAll('\\','/'),bytes:bytes.length,digest:sha256(bytes)});
    }
  }
  for(const root of roots)await visit(root);
  files.sort((a,b)=>compare(a.path,b.path));
  return files;
}
async function readOptionalJson(file){
  try{return JSON.parse(await readFile(file,'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
export async function inventoryCases(repoRoot){
  const manifest=JSON.parse(await readFile(path.join(repoRoot,'tests/fixtures/elk_parity/manifest.json'),'utf8'));
  const cases=[];
  for(const entry of manifest.cases){
    const oracle=await readOptionalJson(path.join(repoRoot,`tests/fixtures/elk_parity/oracles/${entry.id}.elk.json`));
    const input=entry.oracleInput?await readOptionalJson(path.join(repoRoot,entry.oracleInput)):null;
    const boundaries=[...new Set((oracle?.snapshots??[]).map((snapshot)=>snapshot.boundary))].sort(compare);
    cases.push({id:entry.id,tier:entry.tier,inputKind:entry.mechanismProbe?'mechanism-probe':entry.source?'verilog':entry.graph?'inline':'declared-generator',
      inlineGraphPresent:Boolean(entry.graph),capturedProviderInputPresent:Boolean(input),generatorKind:entry.generator?.kind??null,
      sourcePresent:entry.source?await stat(path.join(repoRoot,entry.source)).then((info)=>info.isFile()):null,
      upstreamOraclePresent:Boolean(oracle),upstreamBoundaries:boundaries,
      completeUpstreamPhases:['p1','p2','p3','p4','p5','final'].every((phase)=>boundaries.includes(phase)),
      // This is an evidence inventory, not a claim that generator declarations
      // or checked-in oracle files already passed the current implementation.
      currentRunStatus:'not-run',visualReviewStatus:entry.mechanismProbe?'not-applicable':'pending'});
  }
  return {manifestVersion:manifest.manifestVersion,upstream:manifest.upstream,cases};
}
export async function createQualityBaseline(repoRoot,runId){
  const files=await collectFileHashes(repoRoot),inventory=await inventoryCases(repoRoot);
  const runtimeFiles=files.filter((entry)=>entry.path.startsWith('src/')||entry.path.startsWith('vendor/')||
    ['package.json','index.html','styles.css'].includes(entry.path));
  return {schemaVersion:'1.0.0',runId,createdAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch},
    fileSetDigest:sha256(JSON.stringify(files)),runtimeDigest:sha256(JSON.stringify(runtimeFiles)),files,inventory,
    historicalEvidence:{codeHashes:'not-recorded-at-run-time',unit:'2026-10-11: 718/718',mapped:'2026-10-11: 46/47; dp020 timed out at 45000 ms',
      warning:'Historical results are not results for this newly hashed snapshot.'}};
}
export function compareBaselines(left,right){
  const leftByPath=new Map(left.files.map((entry)=>[entry.path,entry.digest]));
  const byPath=new Map(right.files.map((entry)=>[entry.path,entry.digest]));
  return [...new Set([...leftByPath.keys(),...byPath.keys()])].sort(compare)
    .filter((file)=>leftByPath.get(file)!==byPath.get(file)).map((file)=>({path:file,
      left:leftByPath.get(file)??null,right:byPath.get(file)??null}));
}
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [output,runId,rightFile]=process.argv.slice(2);
  if(!output||!runId)throw new Error('usage: quality_baseline.mjs <output.json> <run-id>');
  if(output==='--compare'){
    const left=JSON.parse(await readFile(runId,'utf8')),right=JSON.parse(await readFile(rightFile,'utf8'));
    console.log(JSON.stringify({runtimeEqual:left.runtimeDigest===right.runtimeDigest,
      fileSetEqual:left.fileSetDigest===right.fileSetDigest,differences:compareBaselines(left,right)}));
  }else{
    const baseline=await createQualityBaseline(repoRoot,runId);
    await mkdir(path.dirname(path.resolve(output)),{recursive:true});
    await writeFile(output,`${JSON.stringify(baseline,null,2)}\n`);
    console.log(JSON.stringify({runId,fileCount:baseline.files.length,runtimeDigest:baseline.runtimeDigest,
      cases:baseline.inventory.cases.length,declaredGenerators:baseline.inventory.cases.filter((entry)=>entry.inputKind==='declared-generator').map((entry)=>entry.id)}));
  }
}
