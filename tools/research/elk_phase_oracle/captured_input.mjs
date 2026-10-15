import assert from 'node:assert/strict';
import {getNetGroupKey} from '../../../src/layout/layoutTopology.js';
import {sha256} from './quality_baseline.mjs';

const encode=(value)=>Buffer.from(String(value),'utf8').toString('base64');

// Preserve the actual provider arrays and measured geometry. Canonical sorting
// belongs to the candidate algorithm, not to the upstream input recorder.
export function serializeCapturedInput(caseId,elkGraph,displayGraph,defaults){
  assert.match(caseId,/^[a-z0-9_]+$/,'unsafe oracle case identifier');
  const options={...defaults,portConstraints:'FIXED_POS',
    nodeNodeSpacing:Number(elkGraph.layoutOptions['elk.spacing.nodeNode']),
    nodeNodeBetweenLayers:Number(elkGraph.layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'])};
  assert.ok(Number.isFinite(options.nodeNodeSpacing)&&Number.isFinite(options.nodeNodeBetweenLayers));
  const body=Object.keys(options).sort().map((key)=>`OPTION\t${key}\t${options[key]}`);
  const nodeByEndpoint=new Map(elkGraph.children.map((node)=>[node.id,node.id]));
  const nodeEndpoints=new Set(nodeByEndpoint.keys());
  for(const node of elkGraph.children){
    body.push(`NODE\t${encode(node.id)}\t${node.width}\t${node.height}\tFIXED_POS`);
    for(const port of node.ports){
      assert.ok(!nodeByEndpoint.has(port.id),`duplicate captured endpoint ${port.id}`);
      nodeByEndpoint.set(port.id,node.id);
      body.push(['PORT',encode(node.id),encode(port.id),port.layoutOptions['elk.port.side'],
        port.x,port.y,port.width,port.height].join('\t'));
    }
  }
  const displayEdges=new Map(displayGraph.edges.map((edge)=>[edge.id,edge]));
  const edges=[];
  for(const edge of elkGraph.edges){
    assert.equal(edge.sources.length,1);assert.equal(edge.targets.length,1);
    assert.ok(nodeByEndpoint.has(edge.sources[0])&&nodeByEndpoint.has(edge.targets[0]),
      `edge ${edge.id} does not resolve to provider nodes/ports`);
    assert.ok(displayEdges.has(edge.id),`missing display edge ${edge.id}`);
    const physicalNet=getNetGroupKey(displayEdges.get(edge.id));
    body.push(['EDGE',encode(edge.id),encode(edge.sources[0]),encode(edge.targets[0]),encode(physicalNet)].join('\t'));
    edges.push({id:edge.id,source:nodeByEndpoint.get(edge.sources[0]),target:nodeByEndpoint.get(edge.targets[0]),
      sourceEndpointId:edge.sources[0],targetEndpointId:edge.targets[0],
      sourceEndpointKind:nodeEndpoints.has(edge.sources[0])?'node':'port',
      targetEndpointKind:nodeEndpoints.has(edge.targets[0])?'node':'port',
      physicalNet});
  }
  const inputBody=`${body.join('\n')}\n`,inputDigest=sha256(inputBody);
  return {inputDigest,options,inputOrder:'provider-array',
    tsv:`CASE\t${encode(caseId)}\t${inputDigest}\n${inputBody}`,
    graph:{nodes:elkGraph.children.map(({id,width,height,ports})=>({id,width,height,ports})),edges}};
}
