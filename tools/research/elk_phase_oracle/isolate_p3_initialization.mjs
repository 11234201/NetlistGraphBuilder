import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {initializationVariants} from './p3_initialization.mjs';
import {graphInOracleOrder} from './upstream_proper_input.mjs';
import {createQualityBaseline,sha256} from './quality_baseline.mjs';
import {fileURLToPath} from 'node:url';
import {orderLayers} from '../../../src/layout/elk_native/p3_ordering.js';
import {countCrossings} from '../../../src/layout/elk_native/crossing_counter.js';
const [file,output]=process.argv.slice(2);
if(!output)throw Error('usage: isolate_p3_initialization.mjs <oracle.json> <output-dir>');
await mkdir(output,{recursive:true});
const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
const baseline=await createQualityBaseline(repoRoot,'q03_p3_initialization');
await writeFile(`${output}/baseline.before.json`,JSON.stringify(baseline,null,2));
const bytes=await readFile(file),oracle=JSON.parse(bytes.toString('utf8')),variants=initializationVariants(oracle),reports=[];
const source=graphInOracleOrder(variants[7].graph,oracle.snapshots.find(snapshot=>snapshot.boundary==='p3'));
const differences={layers:0,nodeGeometry:0,portOrder:0,portGeometry:0};
const observedNodes=new Map(variants[7].graph.nodes.map(node=>[node.id,node]));
const normalPortChanges=[];
for(const layer of variants[0].graph.layers)if(JSON.stringify(layer)!==JSON.stringify(variants[7].graph.layers[layer.index]))differences.layers++;
for(const node of variants[0].graph.nodes){
  const observed=observedNodes.get(node.id),ports=new Map(observed.ports.map(port=>[port.id,port]));
  if(JSON.stringify([node.width,node.height,node.margins])!==JSON.stringify([observed.width,observed.height,observed.margins]))differences.nodeGeometry++;
  if(JSON.stringify(node.ports.map(port=>[port.id,port.order]))!==JSON.stringify(observed.ports.map(port=>[port.id,port.order])))differences.portOrder++;
  if(node.kind!=='long_edge'&&JSON.stringify(node.ports.map(port=>[port.id,port.order]))!==JSON.stringify(observed.ports.map(port=>[port.id,port.order])))
    normalPortChanges.push({id:node.id,constraint:node.portConstraints,count:node.ports.length,
      geometryKeys:[...new Set(node.ports.map(port=>JSON.stringify([port.side,port.x,port.y,port.width,port.height,port.anchor])))],
      canonicalOrder:node.ports.map(port=>port.id),observedOrder:observed.ports.map(port=>port.id)});
  for(const port of node.ports){
    const other=ports.get(port.id);
    if(JSON.stringify([port.x,port.y,port.width,port.height,port.anchor])!==JSON.stringify([other.x,other.y,other.width,other.height,other.anchor]))differences.portGeometry++;
  }
}
const controls=[...variants,...['normal','dummy'].flatMap(portScope=>initializationVariants(oracle,{portScope})
  .filter(({mask})=>mask===2||mask===3).map(entry=>({...entry,name:`${entry.name}:${portScope}`})))];
for(const {mask,name,graph} of controls){
  const before=JSON.stringify(graph),result=orderLayers(graph);
  assert.equal(JSON.stringify(graph),before);
  reports.push({mask,name,inputDigest:graph.inputDigest,initialCrossings:countCrossings(graph),
    crossings:countCrossings(result),differentSourceLayers:result.layers.filter(layer=>JSON.stringify(layer)!==JSON.stringify(source.layers[layer.index])).length,
    phaseData:result.phaseData,layers:result.layers});
  console.log(JSON.stringify({mask,name,initialCrossings:countCrossings(graph),crossings:countCrossings(result)}));
}
await writeFile(`${output}/report.json`,JSON.stringify({caseId:oracle.fixture.caseId,oracleDigest:sha256(bytes),
  runtimeDigest:baseline.runtimeDigest,differences,normalPortChanges,sourceCrossings:countCrossings(source),reports},null,2));
const after=await createQualityBaseline(repoRoot,'q03_p3_initialization_after');
await writeFile(`${output}/baseline.after.json`,JSON.stringify(after,null,2));
assert.equal(after.fileSetDigest,baseline.fileSetDigest,'source/input/tool snapshot changed during diagnosis');
