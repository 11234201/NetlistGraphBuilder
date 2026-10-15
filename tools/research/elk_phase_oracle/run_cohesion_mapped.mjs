import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createQualityBaseline} from './quality_baseline.mjs';
// Reuse the original47-case runner and45s timer; replace only its worker provider.
assert.ok(!process.env.MAPPED_CASE_TIMEOUT_MS||Number(process.env.MAPPED_CASE_TIMEOUT_MS)===45000);
assert.ok(!process.env.EXPECTED_MAPPED_CASES||Number(process.env.EXPECTED_MAPPED_CASES)===47);
assert.ok(!process.env.MAPPED_CASE_ROOT,'use the durable fixed mapped fixture set');
const physicalAnchors=process.argv.includes('--physical-anchors');
const registeredH08=process.argv.includes('--registered-h08');
process.env.C01_STATIC_H08=process.argv.includes('--static-h08')?'1':'0';
process.env.C01_PHYSICAL_ANCHORS=physicalAnchors?'1':'0';
process.env.MAPPED_CASE_PROVIDER=registeredH08?'native-layered':process.env.C01_STATIC_H08==='1'?'h08-static':physicalAnchors?'c01-unit-anchor-research':'c01-unit-research';process.env.MAPPED_CASE_NO_COLLAPSE='1';
if(!process.argv.includes('--hard'))process.argv.push('--hard');
const output=resolve(process.argv[2]);await mkdir(output,{recursive:true});
const root=fileURLToPath(new URL('../../../',import.meta.url));
const before=await createQualityBaseline(root,'c01_mapped');
await writeFile(resolve(output,'baseline.before.json'),JSON.stringify(before,null,2));
const location=new URL('../../test-mapped-cases.mjs',import.meta.url);let source=await readFile(location,'utf8');
const anchor='const worker = path.resolve("tools/test-one-mapped-case.mjs");';
assert.equal(source.split(anchor).length,2);
if(!registeredH08)source=source.replace(anchor,`const worker=${JSON.stringify(fileURLToPath(new URL('./cohesion_mapped_worker.mjs',import.meta.url)))};`);
// Preserve full per-case metrics as a generated artifact without changing verdicts.
source+=`\nawait (await import('node:fs/promises')).writeFile(${JSON.stringify(resolve(output,'results.json'))},JSON.stringify({timeoutMs,expectedCases,hardInvariants,noCollapse,providerId,results},null,2));`;
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const after=await createQualityBaseline(root,'c01_mapped_after');
await writeFile(resolve(output,'baseline.after.json'),JSON.stringify(after,null,2));
assert.equal(before.fileSetDigest,after.fileSetDigest,'source changed during47-case run');
