import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {NativeLayeredLayoutProvider} from '../../../src/layout/elk_native_layout_provider.js';
import {buildFocusedFaninTreeBlocks} from '../../../src/layout/layered/focusedTreeBlocks.js';
import {sha256} from './quality_baseline.mjs';
import {consumeStructuralKey} from './structural_ordering_key.mjs';
const moduleUrl=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
export async function compileCohesionModule(entries,{groupSweep=false,structuralKey=false,implicitPorts=false,layoutUnits=false,physicalAnchors=false}={}){
    const location=new URL('../../../src/layout/elk_native/index.js',import.meta.url);
    let index=await readFile(location,'utf8');
    let baselineP3=new URL('../../../src/layout/elk_native/p3_ordering.js',import.meta.url).href;
    if(structuralKey){
      const baseLocation=new URL(baselineP3),source=consumeStructuralKey(await readFile(baseLocation,'utf8'))
        .replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,baseLocation).href}'`);
      baselineP3=moduleUrl(source);
      const p0=moduleUrl(`import {createCanonicalGraph as original} from '${new URL('../../../src/layout/elk_native/ir.js',import.meta.url).href}';
import {freezeRecord} from '${new URL('../../../src/layout/elk_native/protocol.js',import.meta.url).href}';
import {structuralOrderingKey} from '${new URL('./structural_ordering_key.mjs',import.meta.url).href}';
export function createCanonicalGraph(...args){const canonical=original(...args);return freezeRecord({...canonical,orderingDigest:structuralOrderingKey(canonical)});}`);
      const p0Anchor="import { createCanonicalGraph } from './ir.js';";assert.equal(index.split(p0Anchor).length,2);
      index=index.replace(p0Anchor,`import { createCanonicalGraph } from '${p0}';`);
    }
    const p3=moduleUrl(`import {orderLayers as baseline} from '${baselineP3}';
import {selectOrderGroupCandidate} from '${new URL('./order_group_candidates.mjs',import.meta.url).href}';
import {compileGroupSweep} from '${new URL('./group_sweep.mjs',import.meta.url).href}';
const entries=${JSON.stringify(entries)};
const useGroupSweep=${groupSweep};
const sweep=useGroupSweep&&entries.length?await compileGroupSweep(entries,{structuralKey:${structuralKey},layoutUnits:${layoutUnits}}):null;
export function orderLayers(input,options){const result=baseline(input,options),members=new Set(input.nodes.map(node=>node.id));
const groups=entries.filter(entry=>members.has(entry.nodeId));if(!groups.length)return result;
const extraCandidates=sweep?[{policy:${JSON.stringify(layoutUnits?'unit-sweep':'group-sweep')},graph:sweep(input,options)}]:[];
return selectOrderGroupCandidate(result,groups,{extraCandidates});}`);
    const anchor="import { orderLayers } from './p3_ordering.js';";assert.equal(index.split(anchor).length,2);
    index=index.replace(anchor,`import { orderLayers } from '${p3}';`);
    if(physicalAnchors){
      const {compilePhysicalAnchorRouting}=await import('./physical_anchor_routing.mjs');
      const {routeModule}=await compilePhysicalAnchorRouting();
      const p5Anchor="import { routeEdges } from './p5_routing.js';";assert.equal(index.split(p5Anchor).length,2);
      index=index.replace(p5Anchor,`import {routeEdges} from '${routeModule}';`);
    }
    index=index
      .replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,location).href}'`);
    let layoutModule=moduleUrl(index);
    if(implicitPorts)layoutModule=moduleUrl(`import {layoutGraph as original} from '${layoutModule}';
import {splitImplicitEndpoints} from '${new URL('./probe_alias_key.mjs',import.meta.url).href}';
export {PhaseError} from '${new URL('../../../src/layout/elk_native/protocol.js',import.meta.url).href}';
export const layoutGraph=(input,options)=>original(splitImplicitEndpoints(input),options);`);
    return {layoutModule,compiledIndexDigest:sha256(index),compiledModuleDigest:sha256(layoutModule)};
}
export class CohesionResearchProvider extends NativeLayeredLayoutProvider{
  constructor({groupSweep=false,cohesion=true,structuralKey=false,implicitPorts=false,layoutUnits=false,physicalAnchors=false}={}){
    super();Object.assign(this,{groupSweep,cohesion,structuralKey,implicitPorts,layoutUnits,physicalAnchors});}
  async layout(graph,options={}){
    const entries=this.cohesion?buildFocusedFaninTreeBlocks(graph.nodes,graph.edges).entries:[];
    if(!entries.length&&!this.structuralKey&&!this.implicitPorts&&!this.physicalAnchors)return super.layout(graph,options);
    const {layoutModule,compiledIndexDigest,compiledModuleDigest}=await compileCohesionModule(entries,this);
    const adapterLocation=new URL('../../../src/layout/elk_native_layout_provider.js',import.meta.url);
    let adapter=await readFile(adapterLocation,'utf8');
    const adapterAnchor="from './elk_native/index.js'";assert.equal(adapter.split(adapterAnchor).length,2);
    adapter=adapter.replace(adapterAnchor,`from '${layoutModule}'`)
      .replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,adapterLocation).href}'`);
    const Provider=(await import(moduleUrl(adapter))).NativeLayeredLayoutProvider;
    const result=await new Provider().layout(graph,options);
    return {...result,layoutMetrics:{...result.layoutMetrics,researchCohesion:{
      mode:this.groupSweep?(this.layoutUnits?'four-candidate-unit-sweep':'four-candidate-group-sweep'):'three-candidate-final-order',structuralKey:this.structuralKey,implicitPorts:this.implicitPorts,
      hintDigest:sha256(JSON.stringify(entries)),physicalAnchors:this.physicalAnchors,
      compiledIndexDigest,compiledModuleDigest,productionRuntimeUnchanged:true}}};
  }
}
