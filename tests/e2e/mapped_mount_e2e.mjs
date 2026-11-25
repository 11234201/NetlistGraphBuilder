import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const fixture = "sop_015_mapped.v";
const source = await readFile(new URL("../fixtures/mapped/sop/" + fixture, import.meta.url));
const budgetMs = 90_000;
const rounds = Number(process.env.NGB_MOUNT_ROUNDS || 3);
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 10);
await runBrowserTest(async ({ browser, url }) => {
  for (let round = 1; round <= rounds; round++) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("console", (event) => { if (event.text().startsWith("mount-progress ")) console.log(event.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(url);
      await page.locator("#schematicMount svg").waitFor();
      assert.equal(await page.locator("#layoutProviderSelect").inputValue(), DEFAULT_LAYOUT_PROVIDER_ID);
      await page.locator("#fileInput").setInputFiles({ name: fixture, mimeType: "text/plain", buffer: source });
      await page.waitForFunction((name) => document.querySelector("#statusBar").textContent.includes("Loaded " + name),
        fixture, { timeout: 60_000 });
      await page.evaluate(() => {
        const status = document.querySelector("#statusBar");
        window.mountProbe = { start: performance.now(), firstBatch: null, lastBatch: null, total: 0 };
        const observer = new MutationObserver(() => {
          const progress = status.textContent.match(/^Rendering (\d+)\/(\d+)/);
          if (!progress) return;
          const now = performance.now() - window.mountProbe.start;
          window.mountProbe.firstBatch ??= now;
          window.mountProbe.lastBatch = now;
          window.mountProbe.total = Number(progress[2]);
          const bucket = Math.floor(4 * Number(progress[1]) / window.mountProbe.total);
          if (bucket !== window.mountProbe.bucket) {
            console.log("mount-progress " + progress[0] + " at " + Math.round(now) + " ms");
            window.mountProbe.bucket = bucket;
          }
        });
        observer.observe(status, { subtree: true, childList: true, characterData: true });
      });
      await page.locator("#wholeViewButton").click();
      await page.waitForFunction(() => /^Ready/.test(document.querySelector("#statusBar").textContent) &&
        document.querySelector("#schematicMount .nodes > .node"), undefined, { timeout: budgetMs });
      const metrics = await page.evaluate(() => {
        const elapsed = performance.now() - window.mountProbe.start;
        const mount = document.querySelector("#schematicMount");
        const edges = mount.querySelector(".edges");
        const nodes = mount.querySelector(".nodes");
        return { elapsed, ...window.mountProbe, nodes: nodes.childElementCount, edges: edges.childElementCount,
          labels: nodes.querySelectorAll("text").length, hits: edges.querySelectorAll(".wire-hit-area").length,
          finiteBounds: mount.querySelector("svg").getAttribute("viewBox").split(/\s+/).every((v) => Number.isFinite(Number(v))) };
      });
      console.log(JSON.stringify({ fixture, round, provider: DEFAULT_LAYOUT_PROVIDER_ID, metrics, errors }));
      assert.deepEqual(errors, []);
      assert.ok(metrics.elapsed <= budgetMs, "Full graph exceeded 90 s");
      assert.equal(metrics.edges + metrics.nodes, metrics.total);
      assert.ok(metrics.total > 40_000 && metrics.labels > 0 && metrics.finiteBounds);
      assert.equal(metrics.hits, metrics.edges);
      if (round === 1) await verifyExport(page);
    } catch (error) {
      console.error(JSON.stringify({ fixture, round, errors, status: await page.locator("#statusBar").textContent().catch(() => null),
        progress: await page.evaluate(() => window.mountProbe).catch(() => null) }));
      throw error;
    } finally {
      await page.close();
    }
  }
}, { root, chromium, executablePath: process.env.NGB_CHROME });

async function verifyExport(page) {
  // Compare the full export produced from the authoritative scene with the real
  // completed DOM. Keep the large SVG and its geometry on the browser side.
  const comparison = await page.evaluate(async () => {
    const capture = URL.createObjectURL;
    let exported;
    URL.createObjectURL = function(blob) {
      if (blob.type.includes("svg")) exported = blob.text();
      return capture.call(this, blob);
    };
    try { document.querySelector("#exportSvgButton").click(); }
    finally { URL.createObjectURL = capture; }
    if (!exported) throw new Error("Expected an SVG download");
    const svg = new DOMParser().parseFromString(await exported, "image/svg+xml");
    if (svg.querySelector("parsererror")) throw new Error("Exported SVG is not well formed");
    async function signature(container) {
      const items = container.querySelectorAll(".edges *, .nodes *");
      const values = [];
      const attrs = ["d", "points", "x", "y", "cx", "cy", "r", "rx", "ry", "width", "height", "transform",
        "class", "data-edge-id", "data-node-id", "data-net", "data-wire-route-id", "pointer-events"];
      for (const item of items) {
        const row = [item.localName];
        for (const name of attrs) {
          if (!item.hasAttribute(name)) continue;
          const value = item.getAttribute(name);
          if (/NaN|Infinity/.test(value)) throw new Error("Nonfinite SVG geometry in " + name);
          row.push(name, value);
        }
        if (item.localName === "text") row.push(item.textContent);
        values.push(JSON.stringify(row));
      }
      const bytes = new TextEncoder().encode(values.join("\n"));
      return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (value) => value.toString(16).padStart(2, "0")).join("");
    }
    const mount = document.querySelector("#schematicMount");
    return { canvas: await signature(mount), exported: await signature(svg) };
  });
  assert.equal(comparison.canvas, comparison.exported);
  console.log(JSON.stringify({ fixture, exportGeometrySha256: comparison.exported }));
}
