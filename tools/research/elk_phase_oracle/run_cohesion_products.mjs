import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const sweepIndex=process.argv.indexOf('--sweep'),groupSweep=sweepIndex>=0;
if(groupSweep)process.argv.splice(sweepIndex,1);
const location=new URL('./compare_complete_layouts.mjs',import.meta.url);
let source=await readFile(location,'utf8');
const anchor="import { NativeLayeredLayoutProvider } from '../../../src/layout/elk_native_layout_provider.js';";
assert.equal(source.split(anchor).length,2);
source=source.replace(anchor,`import {CohesionResearchProvider} from '${new URL('./probe_cohesion_provider.mjs',import.meta.url).href}';
class NativeLayeredLayoutProvider extends CohesionResearchProvider{constructor(){super({groupSweep:${groupSweep}});}}`)
  .replace(/from '(\.[^']+)'/g,(_,relative)=>`from '${new URL(relative,location).href}'`);
source=source.replaceAll('import.meta.url',JSON.stringify(location.href));
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
