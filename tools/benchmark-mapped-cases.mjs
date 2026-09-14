import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseVerilog } from "../src/parser/verilogParser.js";
import { buildModuleWorkspace } from "../src/app/moduleWorkspace.js";
import { createWorkspaceArtifactCache } from "../src/app/workspaceArtifactCache.js";
import { getLayoutProvider } from "../src/layout/layoutProvider.js";

const caseRoot = path.resolve(process.env.MAPPED_CASE_ROOT || "tests/fixtures/mapped");
const expectedCases = numberFromEnvironment("EXPECTED_MAPPED_CASES", 47);
const timeoutMs = numberFromEnvironment("MAPPED_BENCHMARK_TIMEOUT_MS", 60_000);
const providerId = process.env.MAPPED_BENCHMARK_PROVIDER || "simple-layered";

if (process.argv[2] === "--worker") {
  const result = await runCase(process.argv[3]);
  process.stdout.write(JSON.stringify(result));
} else {
  await runBatch();
}

async function runBatch() {
  const netlists = (await findMappedNetlists(caseRoot)).sort();
  if (netlists.length !== expectedCases) {
    throw new Error(`Expected ${expectedCases} mapped cases under ${caseRoot}, found ${netlists.length}.`);
  }
  const results = [];
  for (const [index, netlist] of netlists.entries()) {
    const caseName = path.basename(netlist, "_mapped.v");
    const execution = await runWorker(netlist, timeoutMs);
    const result = execution.timedOut
      ? { caseName, timeoutMs, error: "timeout" }
      : parseWorkerResult(execution, caseName);
    results.push(result);
    if (result.error) {
      console.log(`[${index + 1}/${netlists.length}] ${caseName} ${result.error}`);
      continue;
    }
    console.log(`[${index + 1}/${netlists.length}] ${caseName} cells=${result.cells} ` +
      `base=${result.baseMs}ms move=${result.moveMs}ms moveWarm=${result.moveWarmMs}ms ` +
      `focusWarm=${result.focusWarmMs}ms status=${result.layoutStatus}`);
  }
  const successful = results.filter((result) => !result.error);
  console.log(JSON.stringify({
    provider: providerId,
    timeoutMs,
    cases: results.length,
    successful: successful.length,
    failed: results.length - successful.length,
    timedOut: results.filter((result) => result.error === "timeout").length,
    routed: successful.filter((result) => result.layoutStatus === "routed").length,
    unroutable: successful.filter((result) => result.layoutStatus === "unroutable").length,
    medianBaseMs: median(successful.map((result) => result.baseMs)),
    medianMoveMs: median(successful.map((result) => result.moveMs)),
    medianMoveWarmMs: median(successful.map((result) => result.moveWarmMs)),
    medianFocusWarmMs: median(successful.map((result) => result.focusWarmMs)),
    totalCells: successful.reduce((total, result) => total + result.cells, 0),
    maxBaseMs: Math.max(0, ...successful.map((result) => result.baseMs)),
    maxMoveWarmMs: Math.max(0, ...successful.map((result) => result.moveWarmMs))
  }));
}

async function runCase(netlist) {
  const startedAt = performance.now();
  const source = await readFile(netlist, "utf8");
  const design = parseVerilog(source);
  const module = design.modules.find((item) => item.name === "tc") ?? design.modules[0];
  if (!module) throw new Error("No Verilog module found");
  const provider = getLayoutProvider(providerId);
  const cache = createWorkspaceArtifactCache({ capacity: 16 });
  const caseName = path.basename(netlist, "_mapped.v");
  const common = {
    module,
    moduleLibrary: design.modules,
    layoutProvider: provider,
    useFanoutHubs: false,
    collapseLargeGroups: false,
    artifactCache: cache,
    artifactIdentity: {
      documentId: `mapped-benchmark:${caseName}`,
      sourceRevision: 1,
      sourceIdentity: `mapped:${caseName}:${Buffer.byteLength(source)}`,
      sessionId: "mapped-benchmark",
      unitId: module.name
    }
  };
  const base = measure(() => buildModuleWorkspace(common));
  if (isPromise(base.value)) throw new Error("Mapped benchmark requires synchronous layout");
  const root = base.value.fullGraph?.nodes?.find((node) => node.kind === "cell");
  if (!root) throw new Error("Mapped module has no cell root");
  const movedOptions = {
    ...common,
    nodePositions: new Map([[root.id, { x: (root.x || 0) + 36, y: (root.y || 0) + 24 }]])
  };
  const moved = measure(() => buildModuleWorkspace(movedOptions));
  const movedWarm = measure(() => buildModuleWorkspace(movedOptions));
  const focusedOptions = {
    ...common,
    viewMode: "focused",
    focusedRootNodeIds: [root.id],
    activeFocusedRootNodeId: root.id,
    faninDepth: 3,
    fanoutDepth: 3
  };
  const focused = measure(() => buildModuleWorkspace(focusedOptions));
  const focusedWarm = measure(() => buildModuleWorkspace(focusedOptions));
  return {
    caseName,
    cells: module.cells.length,
    baseMs: round(base.ms),
    moveMs: round(moved.ms),
    moveWarmMs: round(movedWarm.ms),
    focusMs: round(focused.ms),
    focusWarmMs: round(focusedWarm.ms),
    graphNodes: base.value.graph?.nodes?.length || 0,
    layoutStatus: base.value.autoGraph?.layoutStatus || "unknown",
    elapsedMs: round(performance.now() - startedAt),
    cache: cache.stats()
  };
}

function runWorker(netlist, timeout) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [process.argv[1], "--worker", netlist], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function parseWorkerResult(execution, caseName) {
  if (execution.code !== 0) {
    return { caseName, error: execution.stderr.trim().split("\n").at(-1) || "worker-exit" };
  }
  try {
    return JSON.parse(execution.stdout);
  } catch {
    return { caseName, error: "invalid-json" };
  }
}

async function findMappedNetlists(root) {
  if (!await isDirectory(root)) throw new Error(`Mapped-case root not found: ${root}`);
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...await findMappedNetlists(entryPath));
    else if (entry.isFile() && entry.name.endsWith("_mapped.v")) found.push(entryPath);
  }
  return found;
}

function measure(action) {
  const startedAt = performance.now();
  const value = action();
  return { value, ms: performance.now() - startedAt };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return round(sorted[Math.floor(sorted.length / 2)]);
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function numberFromEnvironment(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}
