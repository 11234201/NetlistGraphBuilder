import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const url=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
export async function randomModuleUrl({sourceRng=false,graphModel=false}={}){
  const location=new URL('../../../src/layout/elk_native/p3_ordering.js',import.meta.url);
  let source=await readFile(location,'utf8');
  const replace=(before,after)=>{assert.equal(source.split(before).length,2,'missing/ambiguous P3 anchor');source=source.replace(before,after);};
  source=`import {createSourceRandom} from '${new URL('./source_random.mjs',import.meta.url).href}';\n`+source;
  if(sourceRng){
    const start=source.indexOf('function randomStream('),end=source.indexOf('\nfunction sortFreeLayer(',start);
    assert.ok(start>=0&&end>start);
    source=source.slice(0,start)+'function randomStream(digest,seed){return createSourceRandom(seed);}\n'+source.slice(end);
    replace('let forward = random() < 0.5;','let forward = random.boolean();');
    replace('const values = new Map(current[firstIndex].map((id) => [id, random()]));',
      'const values = new Map(current[firstIndex].map((id) => [id, random.double()]));');
    replace('perturbationKey: `${orderingDigest ?? input.inputDigest}:${input.options.randomSeed}`','perturbationKey: random.researchKey');
  }
  if(graphModel){
    replace('  const constraints = input.orderConstraints ?? [];',
      '  const graphOwnedModel = createSourceRandom(input.options.randomSeed).model;\n  const constraints = input.orderConstraints ?? [];');
    replace("const model = attempt % 2 ? 'layer_total' : 'node_relative';",'const model = graphOwnedModel;');
  }
  source=source.replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,location).href}'`);
  return url(source);
}
export async function compileRandomProbe(options){return (await import(await randomModuleUrl(options))).orderLayers;}
export async function compileRandomProvider(options){
  const location=new URL('../../../src/layout/elk_native/index.js',import.meta.url);
  let index=await readFile(location,'utf8');
  const anchor="import { orderLayers } from './p3_ordering.js';";assert.equal(index.split(anchor).length,2);
  index=index.replace(anchor,`import { orderLayers } from '${await randomModuleUrl(options)}';`)
    .replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,location).href}'`);
  const adapterLocation=new URL('../../../src/layout/elk_native_layout_provider.js',import.meta.url);
  let adapter=await readFile(adapterLocation,'utf8');
  const adapterAnchor="from './elk_native/index.js'";assert.equal(adapter.split(adapterAnchor).length,2);
  adapter=adapter.replace(adapterAnchor,`from '${url(index)}'`)
    .replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,adapterLocation).href}'`);
  return (await import(url(adapter))).NativeLayeredLayoutProvider;
}
