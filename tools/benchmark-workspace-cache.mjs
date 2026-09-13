import { performance } from "node:perf_hooks";
import { parseVerilog } from "../src/parser/verilogParser.js";
import { buildModuleWorkspace } from "../src/app/moduleWorkspace.js";
import { createWorkspaceArtifactCache } from "../src/app/workspaceArtifactCache.js";
import { getLayoutProvider } from "../src/layout/layoutProvider.js";

const sizes = String(process.env.BENCHMARK_WORKSPACE_SIZES || "1024,4096")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isInteger(value) && value >= 2 && value <= 100000);

for (const cells of sizes) {
  const design = parseVerilog(createBufferChain(cells));
  const module = design.modules[0];
  const cache = createWorkspaceArtifactCache({ capacity: 8 });
  const options = {
    module,
    moduleLibrary: design.modules,
    layoutProvider: getLayoutProvider("simple-layered"),
    useFanoutHubs: false,
    collapseLargeGroups: false,
    artifactCache: cache,
    artifactIdentity: {
      documentId: `benchmark:${cells}`,
      sourceRevision: 1,
      sourceIdentity: `chain:${cells}`,
      sessionId: "single",
      unitId: module.name
    }
  };
  const cold = measure(() => buildModuleWorkspace(options));
  const warm = measure(() => buildModuleWorkspace(options));
  const speedup = warm.ms > 0 ? cold.ms / warm.ms : Infinity;
  console.log(JSON.stringify({
    cells,
    coldMs: round(cold.ms),
    warmMs: round(warm.ms),
    speedup: Number.isFinite(speedup) ? round(speedup) : "inf",
    cache: cache.stats()
  }));
}

function measure(action) {
  const startedAt = performance.now();
  const value = action();
  if (value && typeof value.then === "function") throw new Error("Workspace cache benchmark requires synchronous layout");
  return { value, ms: performance.now() - startedAt };
}

function createBufferChain(cellCount) {
  const lines = [
    `module benchmark_workspace_${cellCount} (data_in, data_out);`,
    "input data_in;",
    "output data_out;",
    `wire ${Array.from({ length: cellCount - 1 }, (_, index) => `n${index}`).join(", ")};`
  ];
  for (let index = 0; index < cellCount; index += 1) {
    const input = index === 0 ? "data_in" : `n${index - 1}`;
    const output = index === cellCount - 1 ? "data_out" : `n${index}`;
    lines.push(`BUF_X1 u_${index} (.A(${input}), .Z(${output}));`);
  }
  lines.push("endmodule");
  return lines.join("\n");
}

function round(value) {
  return Math.round(value * 10) / 10;
}
