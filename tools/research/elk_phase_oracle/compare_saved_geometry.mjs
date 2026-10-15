import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha256} from './quality_baseline.mjs';

const [baselineDirectory,candidateDirectory]=process.argv.slice(2);
assert.ok(baselineDirectory&&candidateDirectory,'usage: compare_saved_geometry.mjs <baseline-directory> <candidate-directory>');
const files=(await readdir(baselineDirectory)).filter((file)=>file.endsWith('.native-layered.graph.json')).sort();
assert.ok(files.length,'baseline must contain complete candidate graphs');
const geometry=(graph)=>({nodes:graph.nodes,edges:graph.edges,wireRoutes:graph.wireRoutes,
  width:graph.width,height:graph.height,validation:graph.validationMetrics,
  diagnostics:graph.providerDiagnostics,contractVersion:graph.layoutMetrics?.contractVersion,
  inputDigest:graph.layoutMetrics?.inputDigest,components:graph.layoutMetrics?.components,
  placements:graph.layoutMetrics?.placements});
for(const file of files){
  const before=geometry(JSON.parse(await readFile(resolve(baselineDirectory,file),'utf8')));
  const after=geometry(JSON.parse(await readFile(resolve(candidateDirectory,file),'utf8')));
  assert.deepEqual(after,before,`full geometry/evidence differs: ${file}`);
  const svg=file.replace('.graph.json','.svg');
  const oldSvg=await readFile(resolve(baselineDirectory,svg));
  const newSvg=await readFile(resolve(candidateDirectory,svg));
  assert.deepEqual(newSvg,oldSvg,`completed SVG differs: ${svg}`);
  console.log(JSON.stringify({file,geometryEqual:true,svgEqual:true,
    geometryDigest:sha256(JSON.stringify(after)),svgDigest:sha256(newSvg)}));
}
