import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const defaultRoot = path.resolve(
  "tests/fixtures/mapped"
);
const caseRoot = path.resolve(process.env.MAPPED_CASE_ROOT || defaultRoot);
const expectedCases = numberFromEnvironment("EXPECTED_MAPPED_CASES", 47);
const timeoutMs = numberFromEnvironment("MAPPED_CASE_TIMEOUT_MS", 45_000);
const maximumCaseViolations = numberFromEnvironment("MAX_CASE_VIOLATIONS", 32);
const maximumTotalViolations = numberFromEnvironment("MAX_TOTAL_VIOLATIONS", 120);
const noCollapse = process.env.MAPPED_CASE_NO_COLLAPSE === "1";
const worker = path.resolve("tools/test-one-mapped-case.mjs");

if (!await isDirectory(caseRoot)) {
  throw new Error(
    `Mapped-case root not found: ${caseRoot}\n` +
    "Set MAPPED_CASE_ROOT to another mapped-case directory if needed."
  );
}

const netlists = (await findMappedNetlists(caseRoot)).sort();
if (netlists.length !== expectedCases) {
  throw new Error(
    `Expected ${expectedCases} mapped cases under ${caseRoot}, found ${netlists.length}.`
  );
}

const results = [];
for (const [index, netlist] of netlists.entries()) {
  const caseName = path.basename(netlist, "_mapped.v");
  process.stdout.write(`[${index + 1}/${netlists.length}] ${caseName} `);
  const execution = await runWorker(netlist, timeoutMs);
  let metrics = null;
  try {
    metrics = execution.code === 0 ? JSON.parse(execution.stdout) : null;
  } catch {
    // Malformed output is reported as a failed case below.
  }
  const complete = metrics?.routedEdges === metrics?.edges;
  const withinBudget = (metrics?.violations ?? Infinity) <= maximumCaseViolations;
  const passed = !execution.timedOut && execution.code === 0 && complete && withinBudget;
  results.push({ caseName, netlist, passed, execution, metrics });
  console.log(
    execution.timedOut
      ? "TIMEOUT"
      : passed
        ? `PASS ${metrics.layoutMs} ms, violations=${metrics.violations}`
        : "FAIL"
  );
}

const failed = results.filter((result) => !result.passed);
const totalViolations = results.reduce(
  (total, result) => total + (result.metrics?.violations || 0),
  0
);
const maximumLayoutMs = Math.max(...results.map((result) => result.metrics?.layoutMs || 0));
const maximumHeapUsedMiB = Math.max(
  ...results.map((result) => result.metrics?.heapUsedMiB || 0)
);

console.log(
  `mapped cases=${results.length}, failed=${failed.length}, ` +
  `violations=${totalViolations}/${maximumTotalViolations}, ` +
  `maxLayoutMs=${maximumLayoutMs}, maxHeapMiB=${maximumHeapUsedMiB}`
);

if (failed.length > 0 || totalViolations > maximumTotalViolations) {
  for (const result of failed) {
    console.error(`\n${result.caseName}:`);
    console.error(result.execution.stderr.slice(-2000) || JSON.stringify(result.metrics));
  }
  process.exitCode = 1;
}

async function findMappedNetlists(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...await findMappedNetlists(entryPath));
    else if (entry.isFile() && entry.name.endsWith("_mapped.v")) found.push(entryPath);
  }
  return found;
}

function runWorker(netlist, timeout) {
  return new Promise((resolve) => {
    const workerArguments = noCollapse
      ? [worker, netlist, "--no-collapse"]
      : [worker, netlist];
    const child = spawn(process.execPath, workerArguments, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function numberFromEnvironment(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
