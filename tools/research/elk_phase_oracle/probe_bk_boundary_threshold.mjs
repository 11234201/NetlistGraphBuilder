import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {probeBkFromOracle} from './probe_bk_from_oracle.mjs';
import {createQualityBaseline,sha256} from './quality_baseline.mjs';

// Research-only mechanical observer. Production source is never overwritten,
// and this derived module cannot enter the UI pipeline.
export async function compileBoundaryProbe({events=[],orderIncident}={}){
  let source=await readFile(new URL('../../../src/layout/elk_native/bk_compaction.js',import.meta.url),'utf8');
  const replace=(before,after)=>{
    assert.equal(source.split(before).length,2,`ambiguous/missing compactor probe anchor: ${before}`);
    source=source.replace(before,after);
  };
  replace("import { verticalSpacing } from './bk_alignment.js';",
    `import { verticalSpacing } from ${JSON.stringify(new URL('../../../src/layout/elk_native/bk_alignment.js',import.meta.url).href)};`);
  replace('export function compactBlocks(context, layout) {','export function compactBlocks(context, layout, observeDecision, orderIncident) {');
  replace('for (const edge of context.incident.get(free)) {',
    'for (const edge of orderIncident ? orderIncident(free, isRoot, context.incident.get(free), context, layout) : context.incident.get(free)) {');
  replace('  const ids = context.graph.layers.flatMap((layer) => layer.nodeIds);',
    `  const emit=(event)=>observeDecision({...event,direction:horizontal+vertical});\n  const ids = context.graph.layers.flatMap((layer) => layer.nodeIds);`);
  replace('      frame.threshold = threshold(frame.threshold, frame.block, current);',
    `      {\n`
    + `        emit({event:'threshold-call',block:frame.block,free:current,adjacent:adjacent??null,previousThreshold:Number.isFinite(frame.threshold)?frame.threshold:String(frame.threshold)});\n`
    + `        frame.threshold = threshold(frame.threshold, frame.block, current);\n      }`);
  replace('    if (!selected.edge) { if (selected.hasEdges) deferred.push(selected); return invalid; }',
    `    if (!selected.edge) { if (selected.hasEdges) {deferred.push(selected);emit({event:'deferred',free,isRoot,block:root.get(free)});} return invalid; }`);
  replace('    const edge = selected.edge, sourceFree = edge.sourceNodeId === free;',
    `    const edge = selected.edge, sourceFree = edge.sourceNodeId === free;\n    emit({event:'bound-pick',free,isRoot,edgeId:edge.id,block:root.get(free),blockY:y.get(root.get(free))??null,straightened:used.has(root.get(free))});`);
  replace('    if (!delta) return false;',
    `    emit({event:'move-start',free,block,edgeId:edge.id,delta});\n    if (!delta) return false;`);
  replace('    return available > 0;',
    `    emit({event:'move-result',free,block,edgeId:edge.id,delta,available,blockY:y.get(block)});\n    return available > 0;`);
  replace('    const selected = pick(pending.free, pending.isRoot);',
    `    const selected = pick(pending.free, pending.isRoot);\n    emit({event:'post-pick',free:pending.free,isRoot:pending.isRoot,edgeId:selected.edge?.id??null,block:root.get(pending.free),blockY:y.get(root.get(pending.free))??null,straightened:used.has(root.get(pending.free))});`);
  replace('if (frame.index === members.length) { finished.add(frame.block); stack.pop(); continue; }',
    `if (frame.index === members.length) { finished.add(frame.block);emit({event:'finish',free:frame.block,block:frame.block,blockY:y.get(frame.block)}); stack.pop(); continue; }`);
  replace('for (let i = retry.length - 1; i >= 0; i--) moveDeferred(retry[i]);',
    `for (let i = retry.length - 1; i >= 0; i--) {emit({event:'retry',free:retry[i].free,isRoot:retry[i].isRoot,edgeId:retry[i].edge.id});moveDeferred(retry[i]);}`);
  const module=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  return (context,layout)=>module.compactBlocks(context,layout,(event)=>events.push(event),orderIncident);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [oracleFile,output]=process.argv.slice(2);if(!output)throw new Error('usage: probe_bk_boundary_threshold.mjs <oracle.json> <output-dir>');
  await mkdir(output,{recursive:true});
  const repoRoot=fileURLToPath(new URL('../../../',import.meta.url)),baseline=await createQualityBaseline(repoRoot,'q03_bk_boundary');
  await writeFile(path.join(output,'baseline.before.json'),JSON.stringify(baseline,null,2));
  const bytes=await readFile(oracleFile),oracle=JSON.parse(bytes.toString('utf8'));
    const events=[],compactor=await compileBoundaryProbe({events});
    const report={...probeBkFromOracle(oracle,{compactor}),
      boundaryCalls:events.filter((event)=>event.event==='threshold-call'&&event.adjacent===null).length,
      deferredCount:events.filter((event)=>event.event==='deferred').length,events};
    const {events:discardEvents,boundaryCalls,deferredCount,...originalShape}=report;
    assert.deepEqual(probeBkFromOracle(oracle),originalShape);
    console.log(JSON.stringify({matches:report.matches,boundaryCalls:report.boundaryCalls,deferredCount:report.deferredCount,
      candidates:report.candidates.map((candidate)=>({direction:candidate.direction,sizeMatches:candidate.sizeMatches,
        differences:Object.fromEntries(Object.entries(candidate.fields).map(([field,row])=>[field,row.count]))}))}));
  await writeFile(path.join(output,'report.json'),JSON.stringify({traceVersion:'1.0.0',oracleDigest:sha256(bytes),scope:'same pre-P4; observation only; no production change',report},null,2));
  const after=await createQualityBaseline(repoRoot,'q03_bk_boundary_after');
  await writeFile(path.join(output,'baseline.after.json'),JSON.stringify(after,null,2));assert.equal(after.fileSetDigest,baseline.fileSetDigest);
}
