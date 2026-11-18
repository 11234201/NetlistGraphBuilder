import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const artifacts = resolve(process.env.NGB_AIG_PERF_ARTIFACT_DIR || join(root, "dc_runs", `aig-performance-${Date.now()}`));
const chainSize = Number(process.env.NGB_AIG_CHAIN_SIZE || 128);
assert.ok(Number.isInteger(chainSize) && chainSize > 1 && chainSize <= 2000);
await mkdir(artifacts, { recursive: true });
const report = { startedAt: new Date().toISOString(), samples: [], errors: [], externalRequests: [],
  memoryMetric: "Maximum sampled sum of browser process RSS from CDP process IDs and Linux /proc, 50ms interval; includes browser overhead, not an exact allocation peak",
  firstFrameMetric: "First committed visible SVG observed in the mount; candidate scenes render off-screen while the previous document remains visible" };

function wrap(name, inputs, outputs, rows) {
  return `.model ${name}\n.inputs ${inputs.join(" ")}\n.outputs ${outputs.join(" ")}\n${rows.join("\n")}\n.end\n`;
}

function and(left, right, output) { return `.names ${left} ${right} ${output}\n11 1`; }

function cases() {
  const chain = [];
  for (let index = 0; index < chainSize; index += 1) chain.push(and(index ? `n${index - 1}` : "a", "b", `n${index}`));
  const wide = [], wideOutputs = [];
  for (let index = 0; index < 96; index += 1) { wideOutputs.push(`y${index}`); wide.push(and("a", "b", `y${index}`)); }
  const fanout = [and("a", "b", "shared")], fanoutOutputs = [];
  for (let index = 0; index < 256; index += 1) { fanoutOutputs.push(`y${index}`); fanout.push(and("shared", "c", `y${index}`)); }
  const inputs = Array.from({ length: 12 }, (_, index) => `a${index}`);
  const reconvergent = [];
  let previous = inputs;
  for (let depth = 0; depth < 12; depth += 1) {
    const next = Array.from({ length: 12 }, (_, index) => `n${depth}_${index}`);
    for (let index = 0; index < 12; index += 1) reconvergent.push(and(previous[index], previous[(index + 1) % 12], next[index]));
    previous = next;
  }
  return [
    { name: "long_chain", source: wrap("chain", ["a", "b"], [`n${chainSize - 1}`], chain), nodes: chainSize + 3, edges: chainSize * 2 + 1 },
    { name: "wide_layer", source: wrap("wide", ["a", "b"], wideOutputs, wide), nodes: 194, edges: 288 },
    { name: "reconvergent", source: wrap("reconvergent", inputs, previous, reconvergent), nodes: 168, edges: 300 },
    { name: "high_fanout", source: wrap("fanout", ["a", "b", "c"], fanoutOutputs, fanout), nodes: 516, edges: 770 }
  ];
}

async function createMemorySampler(browser) {
  const cdp = await browser.newBrowserCDPSession();
  let maximumKiB = 0;
  let samples = 0;
  let pending = null;
  async function sample() {
    if (pending) return pending;
    pending = (async () => {
      const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
      const values = await Promise.all(processInfo.map(async ({ id }) => {
        try { return Number((await readFile(`/proc/${id}/status`, "utf8")).match(/^VmRSS:\s+(\d+)/m)?.[1] || 0); }
        catch { return 0; }
      }));
      maximumKiB = Math.max(maximumKiB, values.reduce((sum, value) => sum + value, 0));
      samples += 1;
    })().finally(() => { pending = null; });
    return pending;
  }
  await sample();
  const timer = setInterval(() => sample().catch(() => {}), 50);
  return async () => {
    clearInterval(timer);
    if (pending) await pending;
    await sample();
    await cdp.detach();
    return { sampledPeakBrowserRssMiB: Math.round(maximumKiB / 1024 * 10) / 10, memorySamples: samples };
  };
}

try {
  await runBrowserTest(async ({ browser, url }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(error.message));
    page.on("request", (request) => {
      const target = new URL(request.url());
      if (["http:", "https:"].includes(target.protocol) && target.origin !== new URL(url).origin) report.externalRequests.push(target.href);
    });
    await page.addInitScript(() => {
      window.__aigPerf = { calls: [], current: null };
      const NativeWorker = Worker;
      window.Worker = new Proxy(NativeWorker, { construct(target, args) {
        const worker = Reflect.construct(target, args);
        if (String(args[0]).includes("graphviz_worker.js")) {
          const post = worker.postMessage.bind(worker);
          const calls = new Map();
          worker.postMessage = (...values) => {
            const call = { id: values[0].id, start: performance.now() };
            calls.set(call.id, call); window.__aigPerf.calls.push(call);
            return post(...values);
          };
          worker.addEventListener("message", ({ data }) => {
            const call = calls.get(data.id);
            if (call) call.layoutMs = performance.now() - call.start;
          });
        }
        return worker;
      } });
      document.addEventListener("DOMContentLoaded", () => {
        new MutationObserver(() => {
          const current = window.__aigPerf.current;
          const svg = document.querySelector("#schematicMount svg");
          if (current && svg !== current.previous && svg && current.firstVisibleSvgMs === undefined) current.firstVisibleSvgMs = performance.now() - current.start;
        }).observe(document.querySelector("#schematicMount"), { childList: true });
      });
    });
    try {
      await page.goto(url);
      await page.locator("#schematicMount svg").waitFor({ timeout: 45000 });
      for (const scenario of cases()) for (const run of ["first", "warm"]) {
        const name = `${scenario.name}_${run}.blif`;
        report.currentScenario = name;
        const stopMemory = await createMemorySampler(browser);
        let memory;
        await page.evaluate(() => { window.__aigPerf.current = { start: performance.now(), previous: document.querySelector("#schematicMount svg") }; });
        const started = Date.now();
        try {
          await page.locator("#aigFileInput").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(scenario.source) });
          await page.waitForFunction(() => document.querySelector("#cancelDomainImportButton").hidden, null, { timeout: 30000 });
          assert.ok((await page.locator("#statusBar").innerText()).includes(`Loaded ${name}`), await page.locator("#statusBar").innerText());
        } finally { memory = await stopMemory(); report.lastMemory = memory; }
        const totalMs = Date.now() - started;
        const observed = await page.evaluate(() => ({ firstVisibleSvgMs: window.__aigPerf.current.firstVisibleSvgMs,
          layoutMs: window.__aigPerf.calls.at(-1).layoutMs, calls: window.__aigPerf.calls.length,
          nodes: document.querySelectorAll("#schematicMount [data-aig-node]").length,
          edges: document.querySelectorAll("#schematicMount [data-aig-edge]").length }));
        assert.equal(observed.nodes, scenario.nodes);
        assert.equal(observed.edges, scenario.edges);
        assert.ok(Number.isFinite(observed.layoutMs) && Number.isFinite(observed.firstVisibleSvgMs));
        const geometryBefore = await page.locator("#schematicMount .aig-edge-path").evaluateAll((paths) => paths.map((path) => path.getAttribute("d")));
        const highlights = [];
        await page.locator("#settingsMenu > summary").click();
        for (let index = 0; index < 6; index += 1) {
          const start = await page.evaluate(() => performance.now());
          await page.locator('[data-domain-policy="critical"]').setChecked(index % 2 === 1);
          highlights.push(await page.evaluate((start) => performance.now() - start, start));
        }
        assert.equal(await page.evaluate(() => window.__aigPerf.calls.length), observed.calls);
        assert.deepEqual(await page.locator("#schematicMount .aig-edge-path").evaluateAll((paths) => paths.map((path) => path.getAttribute("d"))), geometryBefore);
        await page.keyboard.press("Escape");
        report.samples.push({ name: scenario.name, run, totalMs, ...observed, ...memory,
          highlightRoundTripMs: highlights, note: "Highlight timings include Playwright action overhead; no layout request or path change" });
      }
      assert.deepEqual(report.errors, []);
      assert.deepEqual(report.externalRequests, []);
      report.browser = await browser.version();
      report.status = "passed";
    } catch (error) {
      report.failureStatus = await page.locator("#statusBar").innerText().catch(() => "unavailable");
      await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }, { root, chromium, executablePath: process.env.NGB_CHROME });
} catch (error) {
  report.status = "failed";
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(artifacts, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, samples: report.samples.length, failure: report.failure, artifacts }));
}
