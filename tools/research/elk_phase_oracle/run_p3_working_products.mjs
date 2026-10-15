import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// Reuse the complete product comparison, changing only the research provider import.
const location=new URL('./compare_complete_layouts.mjs',import.meta.url);
let source=await readFile(location,'utf8');
const anchor="import { NativeLayeredLayoutProvider } from '../../../src/layout/elk_native_layout_provider.js';";
assert.equal(source.split(anchor).length,2);
source=source.replace(anchor,`import {compileWorkingOrderProvider} from '${new URL('./probe_p3_working_order.mjs',import.meta.url).href}';
const NativeLayeredLayoutProvider=await compileWorkingOrderProvider();`);
source=source.replace(/from '(\.[^']+)'/g,(_,relative)=>`from '${new URL(relative,location).href}'`);
source=source.replaceAll('import.meta.url',JSON.stringify(location.href));
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
