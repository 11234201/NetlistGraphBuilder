import { readFile } from "node:fs/promises";

const reports = await Promise.all(process.argv.slice(2).map(async (path) => ({ path, ...JSON.parse(await readFile(path, "utf8")) })));
for (const report of reports) {
  const groups = Map.groupBy(report.samples, (sample) => sample.name);
  const summary = {};
  for (const [name, samples] of groups) {
    summary[name] = { nodes: samples[0].nodes, domElements: samples[0].domElements, runs: samples.length };
    for (const kind of ["selection", "zoom", "pan"]) {
      const operations = samples.map((sample) => sample[kind]);
      summary[name][kind] = {
        feedbackP95Ms: distribution(operations.map((op) => op.feedbackMs.p95)),
        frameP95Ms: distribution(operations.map((op) => op.framesMs.p95)),
        layoutMs: distribution(operations.map((op) => op.metrics.LayoutDuration * 1000)),
        styleMs: distribution(operations.map((op) => op.metrics.RecalcStyleDuration * 1000)),
        scriptMs: distribution(operations.map((op) => op.metrics.ScriptDuration * 1000)),
        taskMs: distribution(operations.map((op) => op.metrics.TaskDuration * 1000)),
        paintMs: distribution(operations.map((op) => op.phases?.Paint?.totalMs)),
        transforms: distribution(operations.map((op) => op.transformChanges)),
        inputCount: distribution(operations.map((op) => op.inputCount)),
        slowFrames: distribution(operations.map((op) => op.slowFrames)),
        slowFrameRatio: distribution(operations.map((op) => op.slowFrames / Math.max(1, op.framesMs.count))),
        blockingMs: distribution(operations.map((op) => op.blockingMs)),
        recoveryMs: distribution(operations.flatMap((op) => (op.recoveries || []).map((value) => value.paintProxyMs))),
        recoveryFromLastInputMs: distribution(operations.flatMap((op) => (op.recoveries || []).map((value) => value.fromLastInputMs)))
      };
    }
  }
  console.log(JSON.stringify({ path: report.path, status: report.status, measurementVersion: report.measurementVersion || 1, trace: report.trace, detailMode: report.detailMode,
    violations: report.baselineViolations?.length, summary }, null, 2));
}

function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return { median: +sorted[Math.floor(sorted.length / 2)].toFixed(2), min: +sorted[0].toFixed(2), max: +sorted.at(-1).toFixed(2) };
}
