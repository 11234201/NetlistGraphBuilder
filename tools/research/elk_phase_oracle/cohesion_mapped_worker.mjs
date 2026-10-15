import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const location=new URL('../../test-one-mapped-case.mjs',import.meta.url);
let source=await readFile(location,'utf8');
const anchor=`const provider = providerId === "elk-native-candidate"
  ? new (await import("../src/layout/elk_native_layout_provider.js")).NativeLayeredLayoutProvider()
  : getLayoutProvider(providerId);`;
assert.equal(source.split(anchor).length,2,'mapped worker selection boundary changed');
source=source.replace(anchor,`const provider=process.env.C01_STATIC_H08==='1'
  ? new StaticProvider({profile:'h08'})
  : new CohesionResearchProvider({groupSweep:true,structuralKey:true,implicitPorts:true,layoutUnits:true,physicalAnchors:process.env.C01_PHYSICAL_ANCHORS==='1'});`);
source=`import {NativeLayeredLayoutProvider as StaticProvider} from '${new URL('../../../src/layout/elk_native_layout_provider.js',import.meta.url).href}';\n`+source;
source=`import {CohesionResearchProvider} from '${new URL('./probe_cohesion_provider.mjs',import.meta.url).href}';\n`+source;
source=source.replace(/from ["'](\.[^"']+)["']/g,(_,relative)=>`from '${new URL(relative,location).href}'`);
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
