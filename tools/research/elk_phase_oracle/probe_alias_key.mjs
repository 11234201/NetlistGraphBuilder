import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {layoutGraph as baselineLayout} from '../../../src/layout/elk_native/index.js';
const componentKey=graph=>JSON.stringify(graph.nodes.filter(node=>node.kind!=='long_edge').map(node=>node.id).toSorted());
const moduleUrl=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
import {splitImplicitEndpoints} from '../../../src/layout/elk_native/implicit_endpoints.js';
export {splitImplicitEndpoints} from '../../../src/layout/elk_native/implicit_endpoints.js';
async function frozenLayout(referenceKeys){
  const p3Location=new URL('../../../src/layout/elk_native/p3_ordering.js',import.meta.url);
  let p3=await readFile(p3Location,'utf8');
  const anchor='  const context = crossingContext(input), random = randomStream(orderingDigest ?? input.inputDigest, input.options.randomSeed);';
  assert.equal(p3.split(anchor).length,2);
  p3=p3.replace(anchor,`  const referenceKeys = new Map(${JSON.stringify([...referenceKeys])});
  const componentKey = JSON.stringify(input.nodes.filter(node=>node.kind!=='long_edge').map(node=>node.id).toSorted());
  const perturbationDigest = referenceKeys.get(componentKey);
  if (!perturbationDigest) throw new PhaseError('research','component-key-mismatch');
  const context = crossingContext(input), random = randomStream(perturbationDigest, input.options.randomSeed);`);
  p3=p3.replace('perturbationKey: `${orderingDigest ?? input.inputDigest}:${input.options.randomSeed}`',
    'perturbationKey: `${perturbationDigest}:${input.options.randomSeed}`');
  p3=p3.replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,p3Location).href}'`);
  const indexLocation=new URL('../../../src/layout/elk_native/index.js',import.meta.url);
  let index=await readFile(indexLocation,'utf8');
  const importAnchor="import { orderLayers } from './p3_ordering.js';";
  assert.equal(index.split(importAnchor).length,2);
  index=index.replace(importAnchor,`import { orderLayers } from '${moduleUrl(p3)}';`)
    .replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,indexLocation).href}'`);
  return (await import(moduleUrl(index))).layoutGraph;
}
export async function layoutAliasControl(input,options={},freezeKey=false){
  const original=JSON.stringify(input),split=splitImplicitEndpoints(input);
  let layout=baselineLayout;
  if(freezeKey){
    const keys=new Map();
    await baselineLayout(input,{...options,onPhase:graph=>{if(graph.phase==='p0'){
      const key=componentKey(graph);assert.ok(!keys.has(key));keys.set(key,graph.inputDigest);}}});
    layout=await frozenLayout(keys);
  }
  const result=await layout(split,options);
  assert.equal(JSON.stringify(input),original,'alias control mutated input');
  return result;
}
export async function compileAliasKeyProvider(freezeKey=false){
  const location=new URL('../../../src/layout/elk_native_layout_provider.js',import.meta.url);
  let adapter=await readFile(location,'utf8');
  const helper=moduleUrl(`import {layoutAliasControl} from '${import.meta.url}';
export {PhaseError} from '${new URL('../../../src/layout/elk_native/protocol.js',import.meta.url).href}';
export const layoutGraph=(input,options)=>layoutAliasControl(input,options,${JSON.stringify(freezeKey)});`);
  const anchor="from './elk_native/index.js'";assert.equal(adapter.split(anchor).length,2);
  adapter=adapter.replace(anchor,`from '${helper}'`)
    .replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,location).href}'`);
  return (await import(moduleUrl(adapter))).NativeLayeredLayoutProvider;
}
