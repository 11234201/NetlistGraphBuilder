import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {compileCohesionModule} from './probe_cohesion_provider.mjs';
const staticIndex=process.argv.indexOf('--static-h08'),staticH08=staticIndex>=0;
if(staticH08)process.argv.splice(staticIndex,1);
// Synthetic canonical ports are explicit: only K is active; no pretend fanin hints.
const anchorIndex=process.argv.indexOf('--physical-anchors'),physicalAnchors=anchorIndex>=0;
if(physicalAnchors)process.argv.splice(anchorIndex,1);
const config={groupSweep:true,structuralKey:true,implicitPorts:true,layoutUnits:true,physicalAnchors};
const compiled=staticH08?{layoutModule:new URL('../../../src/layout/elk_native/h08.js',import.meta.url).href}:
  await compileCohesionModule([],config);
const output=resolve(process.argv[2]);await mkdir(output,{recursive:true});
await writeFile(resolve(output,'research_runtime.json'),JSON.stringify({config,hints:[],
  compiledIndexDigest:compiled.compiledIndexDigest,compiledModuleDigest:compiled.compiledModuleDigest,
  productionRuntimeUnchanged:true,scope:'canonical explicit ports; group hints absent'},null,2));
const location=new URL('./compare_quality_corpus.mjs',import.meta.url);let source=await readFile(location,'utf8');
const anchor="import {layoutGraph} from '../../../src/layout/elk_native/index.js';";
assert.equal(source.split(anchor).length,2);
source=source.replace(anchor,`import {layoutGraph} from '${compiled.layoutModule}';`);
const main="if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){";
assert.equal(source.split(main).length,2);source=source.replace(main,'if(true){');
source=source.replace(/from '(\.[^']+)'/g,(_,relative)=>`from '${new URL(relative,location).href}'`)
  .replaceAll('import.meta.url',JSON.stringify(location.href));
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
