import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export {connectPhysicalAnchors} from '../../../src/layout/elk_native/physical_anchor_adjacency.js';
const moduleUrl=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
// Port identities remain distinct. Only scratch P5 boundary adjacency is extended.
export async function compilePhysicalAnchorRouting(){
  const segmentLocation=new URL('../../../src/layout/elk_native/routing_segments.js',import.meta.url);
  let segments=await readFile(segmentLocation,'utf8');
  const anchor='    const assigned=new Set(),segments=[];';assert.equal(segments.split(anchor).length,2);
  segments=segments.replace(anchor,
    `    boundary.physicalAnchorAliases=connectPhysicalAnchors(boundary.edges,ports,adjacency);\n${anchor}`);
  segments=segments.replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,segmentLocation).href}'`);
  const location=new URL('../../../src/layout/elk_native/p5_routing.js',import.meta.url);
  let source=await readFile(location,'utf8');
  const importAnchor="import { createRoutingBoundaries } from './routing_segments.js';";
  assert.equal(source.split(importAnchor).length,2);
  source=source.replace(importAnchor,`import {createRoutingBoundaries} from '${moduleUrl(segments)}';`);
  const eventAnchor="if(observe)events.push({stage,sourceLayerIndex:left,criticalThreshold:boundary.criticalThreshold,";
  assert.equal(source.split(eventAnchor).length,2);
  source=source.replace(eventAnchor,"if(observe)events.push({stage,physicalAnchorAliases:boundary.physicalAnchorAliases,sourceLayerIndex:left,criticalThreshold:boundary.criticalThreshold,");
  source=source.replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${new URL(relative,location).href}'`);
  return {routeModule:moduleUrl(source),createRoutingBoundaries:(await import(moduleUrl(segments))).createRoutingBoundaries};
}
