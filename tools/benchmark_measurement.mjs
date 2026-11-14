import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

// One cold measurement per process. Repeat the command sequentially for a
// median; keep layout/RSS measurements in the full mapped-case runner.
// Usage: node --expose-gc tools/benchmark_measurement.mjs [source-root] [fixture]
if (!global.gc) throw new Error("Run with node --expose-gc");
const root = resolve(process.argv[2] || ".");
const fixture = resolve(root, process.argv[3] || "tests/fixtures/mapped/datapath/dp_020_mapped.v");
const load = (name) => import(pathToFileURL(resolve(root, name)).href);
const { parseVerilog } = await load("src/parser/verilogParser.js");
const { buildSchematicGraph } = await load("src/netlist/graph.js");
const { applyWorkspaceGraphTransforms } = await load("src/app/graphWorkspace.js");
const { measureLegacyLayoutGraph } = await load("src/layout/legacy_measurement.js");
const { materializeMeasuredGraph } = await load("src/layout/measured_geometry.js");
const design = parseVerilog(await readFile(fixture, "utf8"));
const module = design.modules.find((value) => value.name === "tc") ?? design.modules[0];
if (!module) throw new Error(`No module found in ${fixture}`);
const graph = applyWorkspaceGraphTransforms(buildSchematicGraph(module), { collapseLargeGroups: false });
global.gc();
global.gc();
const before = process.memoryUsage().heapUsed;
const started = performance.now();
const measured = measureLegacyLayoutGraph(graph, { focusedOrderGroups: true });
const materialized = materializeMeasuredGraph(measured);
const elapsedMs = performance.now() - started;
const allocated = process.memoryUsage().heapUsed;
global.gc();
global.gc();
const retained = process.memoryUsage().heapUsed;
// These reads deliberately keep BOTH representations live across the full GC.
console.log(JSON.stringify({ root, fixture: relative(root, fixture), fullNode: true,
  contract: measured.contract, nodes: materialized.nodes.length,
  ports: materialized.nodes.reduce((sum, node) => sum + node.ports.length, 0),
  measuredNodes: measured.measurements.nodes.size, elapsedMs: round(elapsedMs),
  allocatedDeltaMiB: round((allocated - before) / 1048576),
  retainedDeltaMiB: round((retained - before) / 1048576),
  nodeVersion: process.version, platform: process.platform, arch: process.arch }));

function round(value) { return Math.round(value * 10) / 10; }
