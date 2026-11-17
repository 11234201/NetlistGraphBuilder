import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";
import { runBrowserTest } from "./browser_test_session.mjs";
import { installInteractionObserver } from "./interaction_observer.mjs";
import { startInteractionTrace } from "./interaction_trace.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const artifacts = resolve(process.env.NGB_INTERACTION_ARTIFACTS || `${root}/dc_runs/interaction-${Date.now()}`);
const runs = integer("NGB_INTERACTION_RUNS", 5, 1, 20);
const clicks = integer("NGB_INTERACTION_CLICKS", 20, 2, 100);
const gestureMs = integer("NGB_INTERACTION_GESTURE_MS", 3000, 500, 10000);
const provider = process.env.NGB_INTERACTION_PROVIDER || DEFAULT_LAYOUT_PROVIDER_ID;
const trace = process.env.NGB_INTERACTION_TRACE === "1";
const baseline = process.env.NGB_INTERACTION_BASELINE === "1";
const diagnosticCss = process.env.NGB_INTERACTION_DIAGNOSTIC_CSS || "";
const detailMode = process.env.NGB_INTERACTION_DETAIL_MODE || "product";
assert.ok(["product", "display", "visibility", "full"].includes(detailMode));
const cases = (process.env.NGB_INTERACTION_CASES || "netlist_1024,netlist_4096,aig_256_standard,aig_1024_standard,aig_256_abc").split(",");
const report = { measurementVersion: 2, browser: null, provider, runs, clicks, gestureMs, trace, detailMode, baseline, diagnosticCss, samples: [], errors: [], baselineViolations: [],
  measurement: "Real pointer/wheel input. Selection feedback/details measured at the second animation frame after pointerdown (presentation proxy, not exact pixel latency). Gesture frames exclude preparation and settlement. No CPU profiler attached." };
await mkdir(artifacts, { recursive: true });

try {
  await runBrowserTest(async ({ browser, url }) => {
    report.browser = await browser.version();
    for (const name of cases) {
      const input = await scenario(name);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(installInteractionObserver);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Performance.enable");
      try {
        await page.goto(url);
        await page.waitForFunction(() => document.querySelector("#schematicMount svg") && !/^(Layout|Rendering)/.test(document.querySelector("#statusBar").textContent));
        await load(page, input);
        if (diagnosticCss) await page.addStyleTag({ content: diagnosticCss });
        if (detailMode !== "product") await page.addStyleTag({ content:
          `.canvas:is(.is-panning,.is-view-interacting) .aig-node:not(.is-selected):not(:focus) .aig-node-label { display: ${detailMode === "display" ? "none" : "inline"} !important; visibility: ${detailMode === "visibility" ? "hidden" : "visible"} !important; }` });
        const geometry = await geometrySignature(page);
        const metadata = await page.evaluate(() => ({
          nodes: document.querySelectorAll("#schematicMount .node, #schematicMount [data-aig-node]").length,
          edges: document.querySelectorAll("#schematicMount .edge, #schematicMount [data-aig-edge]").length,
          domElements: document.querySelectorAll("#schematicMount *").length,
          viewBox: document.querySelector("#schematicMount svg").getAttribute("viewBox"),
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          canvas: { width: document.querySelector("#canvas").clientWidth, height: document.querySelector("#canvas").clientHeight },
          panels: { inspector: document.querySelector("#toggleInspectorButton").getAttribute("aria-expanded"), navigator: document.querySelector("#toggleNavigatorButton").getAttribute("aria-expanded") }
        }));
        assert.ok(metadata.nodes > 0);
        for (let run = -1; run < runs; run++) {
          await focusNeighborhood(page, input);
          const targets = await visibleTargets(page, input.aig);
          assert.ok(targets.length >= 2, `${name}: needs two visible, hittable nodes`);
          const selection = await measure(page, cdp, "select", async () => {
            for (let i = 0; i < clicks; i++) {
              const target = targets[i % targets.length];
              await page.mouse.click(target.x, target.y);
              await page.waitForFunction(({ count, id }) => {
                const latest = window.__interaction.samples.at(-1);
                return window.__interaction.samples.length >= count && latest.id === id;
              }, { count: i + 1, id: target.id });
            }
          });
          assert.equal(selection.selections.length, clicks);
          assert.ok(selection.selections.every((entry) => entry.highlighted && entry.details), "Selection and inspector must match every real click");
          await page.locator("#fitButton").click();
          await page.waitForTimeout(250);
          const blank = await blankPoint(page);
          const beforeZoom = await transform(page);
          const zoom = await measure(page, cdp, "zoom", async () => {
            await page.mouse.move(blank.x, blank.y);
            const started = performance.now();
            let i = 0;
            while (performance.now() - started < gestureMs) {
              // Keep the same bounded reading scale; do not zoom most geometry away.
              await page.mouse.wheel(0, i++ % 12 < 6 ? -40 : 40);
              await page.waitForTimeout(20);
            }
          });
          assert.ok(zoom.transformChanges > 0, "Wheel must update the actual viewport");
          assert.equal(zoom.workerCalls, 0);
          await page.locator("#fitButton").click();
          await page.waitForTimeout(250);
          const origin = await blankPoint(page);
          const beforePan = await transform(page);
          const pan = await measure(page, cdp, "pan", async () => {
            await page.mouse.move(origin.x, origin.y);
            await page.mouse.down();
            const started = performance.now();
            let i = 0;
            while (performance.now() - started < gestureMs) {
              const dx = 35 + 25 * Math.sin(i++ / 8);
              await page.mouse.move(origin.x + dx, origin.y + 12);
              await page.waitForTimeout(16);
            }
            await page.mouse.up();
          });
          assert.notEqual(await transform(page), beforePan, "Pan must move the actual viewport");
          assert.ok(beforeZoom);
          for (const sample of [selection, zoom, pan]) {
            assert.equal(sample.workerCalls, 0, "Interactions must not request automatic layout");
            assert.equal(sample.svgReplacements, 0, "Interactions must retain the SVG root");
            if (sample.kind !== "select" && sample.savesDuringGesture) {
              const violation = { name, run, kind: sample.kind, saves: sample.saves, maximumInputGapMs: sample.maximumInputGapMs };
              if (baseline) report.baselineViolations.push(violation);
              else assert.fail(`High-rate gestures must not persist state: ${JSON.stringify(violation)}`);
            }
          }
          assert.deepEqual(await geometrySignature(page), geometry, "Interactions preserve source geometry");
          assert.deepEqual(errors, []);
          if (run >= 0) {
            // Outside every timed operation: collect retained DOM/listener/heap
            // counts after GC so repeated rounds can reveal lifetime regressions.
            await cdp.send("HeapProfiler.collectGarbage");
            const memory = { ...await cdp.send("Memory.getDOMCounters"),
              heapBytes: (await cdp.send("Performance.getMetrics")).metrics.find(({ name }) => name === "JSHeapUsedSize")?.value };
            report.samples.push({ name, run, ...metadata, sourceSha256: createHash("sha256").update(input.text).digest("hex"),
              viewStyle: input.style || null, memory, selection, zoom, pan });
            await writeFile(`${artifacts}/report.json`, JSON.stringify(report, null, 2));
            console.log(JSON.stringify({ name, run, selectionP95: selection.feedbackMs.p95, zoomP95: zoom.framesMs.p95, panP95: pan.framesMs.p95 }));
          }
        }
      } catch (error) {
        report.errors.push({ name, message: error.message, pageErrors: errors, status: await page.locator("#statusBar").textContent().catch(() => "unavailable") });
        await page.screenshot({ path: `${artifacts}/failure-${name.replaceAll(/[^a-z0-9_-]/gi, "_")}.png` }).catch(() => {});
        throw error;
      } finally { await context.close(); }
    }
  }, { root, chromium, executablePath: process.env.NGB_CHROME });
  report.status = report.baselineViolations.length ? "baseline-with-violations" : "passed";
} catch (error) { report.status = "failed"; report.failure = error.stack; process.exitCode = 1; }
finally { await writeFile(`${artifacts}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ status: report.status, artifacts })); }

async function measure(page, cdp, kind, action) {
  const finishTrace = trace ? await startInteractionTrace(cdp, `${artifacts}/${kind}-${Date.now()}.json`) : null;
  const before = new Map((await cdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]));
  await page.evaluate((kind) => window.__interaction.begin(kind), kind);
  const start = performance.now();
  await action();
  if (kind !== "select") await page.waitForFunction(() => window.__interaction.recoveryComplete &&
    !document.querySelector("#canvas").matches(".is-panning,.is-view-interacting"), null, { timeout: 10000 });
  await page.waitForTimeout(350);
  const observed = await page.evaluate(() => window.__interaction.end());
  const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics
    .filter(({ name }) => /^(Layout|RecalcStyle|Script|Task)(Duration|Count)$/.test(name))
    .map(({ name, value }) => [name, value - before.get(name)]));
  const phases = await finishTrace?.();
  return { kind, ...observed, roundTripMs: performance.now() - start, metrics, phases,
    feedbackMs: stats(observed.selections.map((entry) => entry.ms)), framesMs: stats(observed.frames),
    slowFrames: observed.frames.filter((ms) => ms > 34).length,
    blockingMs: observed.longTasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0) };
}

async function load(page, input) {
  await page.locator(input.aig ? "#aigFileInput" : "#fileInput").setInputFiles({ name: input.name, mimeType: "text/plain", buffer: Buffer.from(input.text) });
  await page.waitForFunction((name) => document.querySelector("#statusBar").textContent.includes(`Loaded ${name}`), input.name, { timeout: 60000 });
  if (input.aig) {
    if (input.style === "abc") {
      await page.locator('[data-domain-policy="viewStyle"]').selectOption("abc");
      await page.waitForFunction(() => document.querySelector("#statusBar").textContent === "AIG view: ABC", null, { timeout: 30000 });
    }
  } else {
    if (provider !== DEFAULT_LAYOUT_PROVIDER_ID) {
      await page.locator("#layoutMenu > summary").click();
      await page.locator("#layoutProviderSelect").selectOption(provider);
      await page.keyboard.press("Escape");
    }
    assert.equal(await page.locator("#layoutProviderSelect").inputValue(), provider);
    await page.locator("#wholeViewButton").click();
    await page.waitForFunction(() => document.querySelector("#schematicMount .node") && /^Ready/.test(document.querySelector("#statusBar").textContent), null, { timeout: 90000 });
  }
  await page.waitForTimeout(300);
}

async function focusNeighborhood(page, input) {
  await page.locator("#fitButton").click();
  const label = input.label || await page.locator('#schematicMount .node[data-kind="cell"]').first().getAttribute("data-label");
  await page.locator("#searchInput").fill(label);
  let results = page.locator(".search-result").filter({ has: page.locator(".search-result-kind", { hasText: input.aig ? /^and$/i : /^instance$/i }) });
  // AIG search includes source names, while the displayed AND label is canonical.
  if (!input.aig) results = results.filter({ has: page.locator(".search-result-label", { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });
  const row = results.first();
  await row.locator("[data-search-index]").click();
  if (!input.aig) await page.locator("#focusSelectedButton").click();
  await page.waitForTimeout(250);
}

async function visibleTargets(page, aig) {
  return page.evaluate((aig) => {
    const canvas = document.querySelector("#canvas").getBoundingClientRect();
    return [...document.querySelectorAll(aig ? "#schematicMount [data-aig-node]" : "#schematicMount .node")].flatMap((node) => {
      const box = (node.querySelector(aig ? ".aig-node-shape" : ".node-shape") || node).getBoundingClientRect();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      if (box.width < 5 || x < canvas.x + 10 || x > canvas.right - 10 || y < canvas.y + 10 || y > canvas.bottom - 10) return [];
      const hit = document.elementFromPoint(x, y)?.closest(aig ? "[data-aig-node]" : "[data-node-id]");
      return hit === node ? [{ x, y, id: aig ? node.dataset.aigNode : node.dataset.nodeId }] : [];
    }).slice(0, 4);
  }, aig);
}

async function blankPoint(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#canvas"), box = canvas.getBoundingClientRect();
    for (const dx of [20, 70, 140]) for (const dy of [20, 70, 140]) {
      const x = box.x + dx, y = box.y + dy, hit = document.elementFromPoint(x, y);
      if (canvas.contains(hit) && !hit.closest("[data-node-id], [data-edge-id], [data-domain-object]")) return { x, y };
    }
    throw new Error("No blank pan origin found");
  });
}

function transform(page) { return page.locator("#schematicMount #schematicContent").getAttribute("transform"); }
function geometrySignature(page) { return page.locator("#schematicMount svg").evaluate((svg) => [...svg.querySelectorAll("[d], [points], [x], [y], [cx]")]
  .map((node) => [node.tagName, ...["d", "points", "x", "y", "cx", "cy", "width", "height"].map((name) => node.getAttribute(name))])); }
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50: sorted[Math.floor(sorted.length / 2)] ?? null, p95: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, max: sorted.at(-1) ?? null };
}
function integer(name, fallback, min, max) { const value = Number(process.env[name] || fallback); assert.ok(Number.isInteger(value) && value >= min && value <= max, name); return value; }
async function scenario(name) {
  if (name.startsWith("mapped:")) {
    const path = name.slice(7);
    assert.match(path, /^(datapath|equal|sop)\/[a-z0-9_]+_mapped\.v$/);
    return { name: path.split("/").at(-1), text: await readFile(`${root}/tests/fixtures/mapped/${path}`, "utf8") };
  }
  const match = /^(netlist|aig)_(\d+)(?:_(standard|abc))?$/.exec(name);
  assert.ok(match, `Unknown case ${name}`);
  const size = Number(match[2]); assert.ok(size >= 2 && size <= 8192);
  if (match[1] === "netlist") return { name: `${name}.v`, label: `u_${Math.floor(size / 2)}`,
    text: `module benchmark(a,z); input a; output z; wire ${Array.from({ length: size - 1 }, (_, i) => `n${i}`).join(",")};\n` +
      Array.from({ length: size }, (_, i) => `BUF_X1 u_${i} (.A(${i ? `n${i - 1}` : "a"}), .Z(${i === size - 1 ? "z" : `n${i}`}));`).join("\n") + "\nendmodule" };
  return { aig: true, style: match[3] || "standard", name: `${name}.blif`, label: `g${Math.floor(size / 2)}`,
    text: `.model benchmark\n.inputs a b\n.outputs ${Array.from({ length: size }, (_, i) => `g${i}`).join(" ")}\n` +
      Array.from({ length: size }, (_, i) => `.names a b g${i}\n11 1`).join("\n") + "\n.end\n" };
}
