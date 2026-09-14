import { performance } from "node:perf_hooks";
import { parseVerilog } from "../src/parser/verilogParser.js";
import { buildModuleWorkspace } from "../src/app/moduleWorkspace.js";
import { createWorkspaceArtifactCache } from "../src/app/workspaceArtifactCache.js";
import { getLayoutProvider } from "../src/layout/layoutProvider.js";

const sizes = String(process.env.BENCHMARK_INTERACTION_SIZES || "1024,4096")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isInteger(value) && value >= 2 && value <= 100000);

for (const cells of sizes) {
  const design = parseVerilog(createBufferChain(cells));
  const module = design.modules[0];
  const cache = createWorkspaceArtifactCache({ capacity: 16 });
  const common = {
    module,
    moduleLibrary: design.modules,
    layoutProvider: getLayoutProvider("simple-layered"),
    useFanoutHubs: false,
    collapseLargeGroups: false,
    artifactCache: cache,
    artifactIdentity: {
      documentId: `benchmark:interaction:${cells}`,
      sourceRevision: 1,
      sourceIdentity: `chain:${cells}`,
      sessionId: "single",
      unitId: module.name
    }
  };
  const base = measure(() => buildModuleWorkspace(common));
  const baseWarm = measure(() => buildModuleWorkspace(common));
  const middle = `cell:u_${Math.floor(cells / 2)}`;
  const moved = {
    ...common,
    nodePositions: new Map([[middle, { x: 36, y: 48 }]])
  };
  const move = measure(() => buildModuleWorkspace(moved));
  const moveWarm = measure(() => buildModuleWorkspace(moved));
  const focused = {
    ...common,
    viewMode: "focused",
    focusedRootNodeIds: [middle],
    activeFocusedRootNodeId: middle,
    faninDepth: 3,
    fanoutDepth: 3
  };
  const focus = measure(() => buildModuleWorkspace(focused));
  const focusWarm = measure(() => buildModuleWorkspace(focused));
  console.log(JSON.stringify({
    cells,
    baseMs: round(base.ms),
    baseWarmMs: round(baseWarm.ms),
    moveMs: round(move.ms),
    moveWarmMs: round(moveWarm.ms),
    focusMs: round(focus.ms),
    focusWarmMs: round(focusWarm.ms),
    cache: cache.stats()
  }));
}

function measure(action) {
  const startedAt = performance.now();
  const value = action();
  if (value && typeof value.then === "function") throw new Error("Interaction benchmark requires synchronous layout");
  return { value, ms: performance.now() - startedAt };
}

function createBufferChain(cellCount) {
  const lines = [
    `module benchmark_interaction_${cellCount} (data_in, data_out);`,
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
