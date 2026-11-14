import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

// Preserve the full strict mapped runner, then distinguish its natural heap
// sample, full-GC live heap and process peak RSS. Never force GC during layout.
// Usage: node --expose-gc tools/benchmark_mapped_memory.mjs [source-root] [fixture]
if (!global.gc) throw new Error("Run with node --expose-gc");
const root = resolve(process.argv[2] || ".");
const fixture = resolve(root, process.argv[3] || "tests/fixtures/mapped/datapath/dp_020_mapped.v");
const runner = resolve(root, "tools/test-one-mapped-case.mjs");
process.argv = [process.execPath, runner, fixture, "--no-collapse", "--hard"];
await import(pathToFileURL(runner).href);
const before = process.memoryUsage();
global.gc();
global.gc();
const after = process.memoryUsage();
console.log(JSON.stringify({ memoryDiagnostic: true, root, fixture: relative(root, fixture),
  beforeFullGcMiB: inMiB(before), afterFullGcMiB: inMiB(after),
  maxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024 * 10) / 10,
  nodeVersion: process.version, platform: process.platform, arch: process.arch }));

function inMiB(memory) {
  return Object.fromEntries(Object.entries(memory).map(([name, bytes]) =>
    [name, Math.round(bytes / 1048576 * 10) / 10]));
}
