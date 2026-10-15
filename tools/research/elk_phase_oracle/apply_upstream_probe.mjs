import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const upstreamRoot = process.argv[2];
assert.ok(upstreamRoot?.endsWith('/elk-layered-phase-oracle-pinned'),
  'refusing to patch an unexpected upstream directory');

const p3Path = path.join(upstreamRoot,
  'plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p3order/LayerSweepCrossingMinimizer.java');
let source = await readFile(p3Path, 'utf8');
const replacements = [
  [
    'import org.eclipse.elk.alg.layered.LayeredPhases;\n',
    'import org.eclipse.elk.alg.layered.LayeredPhases;\nimport org.eclipse.elk.alg.layered.PhaseOracleTrace;\n'
  ],
  [
    '            improved |= sweepReducingCrossings(gData, isForwardSweep, false);\n            isForwardSweep = !isForwardSweep;',
    '            improved |= sweepReducingCrossings(gData, isForwardSweep, false);\n'
      + '            PhaseOracleTrace.p3("candidate", gData, isForwardSweep,\n'
      + '                    countCurrentNumberOfCrossings(gData), improved);\n'
      + '            isForwardSweep = !isForwardSweep;'
  ],
  [
    '                double crossings = minimizeCrossingsNodePortOrderWithCounter(gData);\n',
    '                double crossings = minimizeCrossingsNodePortOrderWithCounter(gData);\n'
      + '                PhaseOracleTrace.p3("attempt", gData, null, crossings, crossings < bestCrossings);\n'
  ],
  [
    '                int crossings = minimizeCrossingsWithCounter(gData);\n',
    '                int crossings = minimizeCrossingsWithCounter(gData);\n'
      + '                PhaseOracleTrace.p3("attempt", gData, null, crossings, crossings < bestCrossings);\n'
  ],
  [
    '        int crossingsInGraph = countCurrentNumberOfCrossings(gData);\n',
    '        int crossingsInGraph = countCurrentNumberOfCrossings(gData);\n'
      + '        PhaseOracleTrace.p3("candidate", gData, isForwardSweep, crossingsInGraph, true);\n'
  ],
  [
    '            crossingsInGraph = countCurrentNumberOfCrossings(gData);\n',
    '            crossingsInGraph = countCurrentNumberOfCrossings(gData);\n'
      + '            PhaseOracleTrace.p3("candidate", gData, isForwardSweep, crossingsInGraph,\n'
      + '                    crossingsInGraph < oldNumberOfCrossings);\n'
  ],
  [
    '        double crossingsInGraph = countCurrentNumberOfCrossingsNodePortOrder(gData);\n',
    '        double crossingsInGraph = countCurrentNumberOfCrossingsNodePortOrder(gData);\n'
      + '        PhaseOracleTrace.p3("candidate", gData, isForwardSweep, crossingsInGraph, true);\n'
  ],
  [
    '            crossingsInGraph = countCurrentNumberOfCrossingsNodePortOrder(gData);\n',
    '            crossingsInGraph = countCurrentNumberOfCrossingsNodePortOrder(gData);\n'
      + '            PhaseOracleTrace.p3("candidate", gData, isForwardSweep, crossingsInGraph,\n'
      + '                    crossingsInGraph < oldNumberOfCrossings);\n'
  ]
];

let applied = 0;
for (const [before, after] of replacements) {
  if (source.includes(after)) continue;
  const first = source.indexOf(before);
  assert.ok(first >= 0, `missing pinned P3 source anchor: ${before.slice(0, 80)}`);
  assert.equal(source.indexOf(before, first + before.length), -1,
    `ambiguous pinned P3 source anchor: ${before.slice(0, 80)}`);
  source = source.replace(before, after);
  applied++;
}
if (applied) await writeFile(p3Path, source);

const p2Path = path.join(upstreamRoot,
  'plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p2layers/NetworkSimplexLayerer.java');
let p2Source = await readFile(p2Path, 'utf8');
const p2Replacements = [
  [
    'import org.eclipse.elk.alg.layered.LayeredPhases;\n',
    'import org.eclipse.elk.alg.layered.LayeredPhases;\nimport org.eclipse.elk.alg.layered.PhaseOracleTrace;\n'
  ],
  [
    '                    .execute(monitor.subTask(1));\n',
    '                    .execute(monitor.subTask(1));\n'
      + '            PhaseOracleTrace.p2(graph, iterLimit);\n'
  ]
];
let p2Applied = 0;
for (const [before, after] of p2Replacements) {
  if (p2Source.includes(after)) continue;
  const first = p2Source.indexOf(before);
  assert.ok(first >= 0, `missing pinned P2 source anchor: ${before.slice(0, 80)}`);
  assert.equal(p2Source.indexOf(before, first + before.length), -1,
    `ambiguous pinned P2 source anchor: ${before.slice(0, 80)}`);
  p2Source = p2Source.replace(before, after);
  p2Applied++;
}
if (p2Applied) await writeFile(p2Path, p2Source);

const p4Path = path.join(upstreamRoot,
  'plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p4nodes/bk/BKNodePlacer.java');
let p4Source = await readFile(p4Path, 'utf8');
const p4Replacements = [
  [
    '        // Apply calculated positions to nodes.\n',
    '        PhaseOracleBkTrace.capture(markedEdges, layouts, chosenLayout);\n'
      + '        // Apply calculated positions to nodes.\n'
  ],
  [
    '        return feasible;\n    }\n}',
    '        PhaseOracleBkTrace.feasible(bal, feasible);\n'
      + '        return feasible;\n    }\n}'
  ]
];
let p4Applied = 0;
for (const [before, after] of p4Replacements) {
  if (p4Source.includes(after)) continue;
  const first = p4Source.indexOf(before);
  assert.ok(first >= 0, `missing pinned P4 source anchor: ${before.slice(0, 80)}`);
  assert.equal(p4Source.indexOf(before, first + before.length), -1,
    `ambiguous pinned P4 source anchor: ${before.slice(0, 80)}`);
  p4Source = p4Source.replace(before, after);
  p4Applied++;
}
if (p4Applied) await writeFile(p4Path, p4Source);

const thresholdPath=path.join(upstreamRoot,
  'plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p4nodes/bk/ThresholdStrategy.java');
let thresholdSource=await readFile(thresholdPath,'utf8');
const thresholdReplacements=[
  ['        blockFinished.add(n);\n',
    '        blockFinished.add(n);\n        PhaseOracleBkTrace.decision(bal, "finish", n, true, null, null, null);\n'],
  ['                final LNode blockRoot, final LNode currentNode) {\n',
    '                final LNode blockRoot, final LNode currentNode) {\n'
      +'            PhaseOracleBkTrace.threshold(bal, blockRoot, currentNode, oldThresh, ni.nodeIndex[currentNode.id]);\n'],
  ['                 postProcessablesQueue.add(pick);\n',
    '                 postProcessablesQueue.add(pick);\n'
      +'                 PhaseOracleBkTrace.decision(bal, "deferred", blockNode, isRoot, null, pick.hasEdges, null);\n'],
  ['            } else if (pick.edge != null) {\n',
    '            } else if (pick.edge != null) {\n'
      +'                PhaseOracleBkTrace.decision(bal, "bound-pick", blockNode, isRoot, pick.edge, pick.hasEdges, null);\n'],
  ['                Postprocessable pick = pickEdge(pp);\n',
    '                Postprocessable pick = pickEdge(pp);\n'
      +'                PhaseOracleBkTrace.decision(bal, "post-pick", pp.free, pp.isRoot, pp.edge, pp.hasEdges, null);\n'],
  ['                process(postProcessablesStack.pop());\n',
    '                Postprocessable pending = postProcessablesStack.pop();\n'
      +'                PhaseOracleBkTrace.decision(bal, "retry", pending.free, pending.isRoot, pending.edge, pending.hasEdges, null);\n'
      +'                process(pending);\n'],
  ['            double delta = bal.calculateDelta(fix, block);\n',
    '            double delta = bal.calculateDelta(fix, block);\n'
      +'            PhaseOracleBkTrace.decision(bal, "move-start", pp.free, pp.isRoot, edge, pp.hasEdges, delta);\n'],
  ['                bal.shiftBlock(block.getNode(), -availableSpace);\n',
    '                bal.shiftBlock(block.getNode(), -availableSpace);\n'
      +'                PhaseOracleBkTrace.decision(bal, "move-result", pp.free, pp.isRoot, edge, pp.hasEdges, availableSpace);\n'],
  ['                bal.shiftBlock(block.getNode(), availableSpace);\n',
    '                bal.shiftBlock(block.getNode(), availableSpace);\n'
      +'                PhaseOracleBkTrace.decision(bal, "move-result", pp.free, pp.isRoot, edge, pp.hasEdges, availableSpace);\n']
];
let thresholdApplied=0;
for(const [before,after] of thresholdReplacements){
  if(thresholdSource.includes(after))continue;
  const first=thresholdSource.indexOf(before);
  assert.ok(first>=0,`missing pinned threshold anchor: ${before}`);
  assert.equal(thresholdSource.indexOf(before,first+before.length),-1,`ambiguous pinned threshold anchor: ${before}`);
  thresholdSource=thresholdSource.replace(before,after);thresholdApplied++;
}
if(thresholdApplied)await writeFile(thresholdPath,thresholdSource);

const p5Path = path.join(upstreamRoot,
  'plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p5edges/orthogonal/OrthogonalRoutingGenerator.java');
let p5Source = await readFile(p5Path, 'utf8');
const p5Replacements = [
  [
    '            final double startPos) {\n\n        // Keep track of our hyperedge segements',
    '            final double startPos) {\n\n        PhaseOracleRoutingTrace.begin();\n'
      + '        // Keep track of our hyperedge segements'
  ],
  [
    '        // write the full dependency graph to an output file\n',
    '        PhaseOracleRoutingTrace.capture("dependencies", sourceLayerIndex, edgeSegments,\n'
      + '                criticalConflictThreshold, startPos, edgeSpacing, null);\n'
      + '        // write the full dependency graph to an output file\n'
  ],
  [
    '        // break non-critical cycles\n        breakNonCriticalCycles(edgeSegments, random);\n',
    '        PhaseOracleRoutingTrace.capture("after-critical", sourceLayerIndex, edgeSegments,\n'
      + '                criticalConflictThreshold, startPos, edgeSpacing, null);\n'
      + '        // break non-critical cycles\n        breakNonCriticalCycles(edgeSegments, random);\n'
      + '        PhaseOracleRoutingTrace.capture("acyclic", sourceLayerIndex, edgeSegments,\n'
      + '                criticalConflictThreshold, startPos, edgeSpacing, null);\n'
  ],
  [
    '        topologicalNumbering(edgeSegments);\n',
    '        topologicalNumbering(edgeSegments);\n'
      + '        PhaseOracleRoutingTrace.capture("slotted", sourceLayerIndex, edgeSegments,\n'
      + '                criticalConflictThreshold, startPos, edgeSpacing, null);\n'
  ],
  [
    '        // release the created resources\n        routingStrategy.clearCreatedJunctionPoints();',
    '        PhaseOracleRoutingTrace.capture("routed", sourceLayerIndex, edgeSegments,\n'
      + '                criticalConflictThreshold, startPos, edgeSpacing, rankCount + 1);\n'
      + '        // release the created resources\n        routingStrategy.clearCreatedJunctionPoints();'
  ],
  [
    '        segmentSplitter.splitSegments(cycleDependencies, edgeSegments, criticalConflictThreshold);\n',
    '        for (HyperEdgeSegmentDependency dependency : cycleDependencies) {\n'
      + '            PhaseOracleRoutingTrace.decision("critical-cycle", dependency);\n'
      + '        }\n'
      + '        segmentSplitter.splitSegments(cycleDependencies, edgeSegments, criticalConflictThreshold);\n'
  ],
  [
    '                cycleDependency.remove();\n',
    '                PhaseOracleRoutingTrace.decision("remove", cycleDependency);\n'
      + '                cycleDependency.remove();\n'
  ],
  [
    '                cycleDependency.reverse();\n',
    '                PhaseOracleRoutingTrace.decision("reverse", cycleDependency);\n'
      + '                cycleDependency.reverse();\n'
  ]
];
let p5Applied = 0;
for (const [before, after] of p5Replacements) {
  if (p5Source.includes(after)) continue;
  const first = p5Source.indexOf(before);
  assert.ok(first >= 0, `missing pinned P5 source anchor: ${before.slice(0, 80)}`);
  assert.equal(p5Source.indexOf(before, first + before.length), -1,
    `ambiguous pinned P5 source anchor: ${before.slice(0, 80)}`);
  p5Source = p5Source.replace(before, after);
  p5Applied++;
}
if (p5Applied) await writeFile(p5Path, p5Source);

const routerPath = path.join(upstreamRoot,
  'plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p5edges/OrthogonalEdgeRouter.java');
let routerSource = await readFile(routerPath, 'utf8');
const routerReplacements = [
  [
    'import org.eclipse.elk.alg.layered.LayeredPhases;\n',
    'import org.eclipse.elk.alg.layered.LayeredPhases;\nimport org.eclipse.elk.alg.layered.PhaseOracleTrace;\n'
  ],
  [
    '            // Route edges between the two layers\n            double startPos =',
    '            // Route edges between the two layers\n'
      + '            double boundaryStartX = xpos;\n            double startPos ='
  ],
  [
    '            leftLayer = rightLayer;\n',
    '            PhaseOracleTrace.p5Width(leftLayerIndex, slotsCount, boundaryStartX, xpos,\n'
      + '                    nodeNodeSpacing, edgeNodeSpacing, edgeEdgeSpacing,\n'
      + '                    isLeftLayerExternal, isRightLayerExternal);\n'
      + '            leftLayer = rightLayer;\n'
  ]
];
let routerApplied = 0;
for (const [before, after] of routerReplacements) {
  if (routerSource.includes(after)) continue;
  const first = routerSource.indexOf(before);
  assert.ok(first >= 0, `missing pinned P5 router anchor: ${before.slice(0, 80)}`);
  assert.equal(routerSource.indexOf(before, first + before.length), -1,
    `ambiguous pinned P5 router anchor: ${before.slice(0, 80)}`);
  routerSource = routerSource.replace(before, after);
  routerApplied++;
}
if (routerApplied) await writeFile(routerPath, routerSource);

const splitterPath = path.join(upstreamRoot,
  'plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/p5edges/orthogonal/HyperEdgeSegmentSplitter.java');
let splitterSource = await readFile(splitterPath, 'utf8');
const splitBefore = '        segments.add(segment.splitAt(splitPosition));\n';
const splitAfter = '        PhaseOracleRoutingTrace.split(segment, splitPosition);\n' + splitBefore;
let splitterApplied = 0;
if (!splitterSource.includes(splitAfter)) {
  assert.ok(splitterSource.includes(splitBefore), 'missing pinned P5 splitter anchor');
  splitterSource = splitterSource.replace(splitBefore, splitAfter);
  await writeFile(splitterPath, splitterSource);
  splitterApplied = 1;
}
console.log(JSON.stringify({ upstreamRoot, p2: { applied: p2Applied, anchors: p2Replacements.length },
  p3: { applied, anchors: replacements.length },
  p4: { applied: p4Applied, anchors: p4Replacements.length },
  threshold: {applied:thresholdApplied,anchors:thresholdReplacements.length},
  p5: { applied: p5Applied, anchors: p5Replacements.length },
  router: { applied: routerApplied, anchors: routerReplacements.length }, splitterApplied }));
