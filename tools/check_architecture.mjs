import { fileURLToPath } from "node:url";
import { buildModuleGraph, readModuleSources, findBoundaryViolations, findModuleCycles } from "./module_graph.mjs";

const root = fileURLToPath(new URL("../src", import.meta.url));
const { graph, diagnostics } = buildModuleGraph(readModuleSources(root));
const violations = findBoundaryViolations(graph);
const cycles = findModuleCycles(graph);
for (const message of [...diagnostics, ...violations, ...cycles.map((path) => `cycle: ${path.join(" -> ")}`)]) console.error(message);
console.log(`architecture: modules=${graph.size}, edges=${[...graph.values()].reduce((count, edges) => count + edges.length, 0)}, unresolved=${diagnostics.length}, boundaryViolations=${violations.length}, cycles=${cycles.length}`);
if (diagnostics.length || violations.length || cycles.length) process.exitCode = 1;
