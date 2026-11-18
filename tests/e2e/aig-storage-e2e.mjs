import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const artifacts = resolve(process.env.NGB_AIG_STORAGE_ARTIFACT_DIR || join(root, "dc_runs", `aig-storage-${Date.now()}`));
const source = await readFile(join(root, "tests/fixtures/aig/shared_cone.blif"), "utf8");
const report = { cases: [], errors: [], externalRequests: [] };
const storageKey = "ngb.domain-workspace.v1";
let currentCase;
await mkdir(artifacts, { recursive: true });

async function loadAig(page, name, text = source) {
  await page.locator("#aigFileInput").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  await page.waitForFunction((name) => document.querySelector("#statusBar").textContent.includes(`Loaded ${name}`), name);
  await page.locator("#schematicMount [data-aig-node]").first().waitFor();
}

try {
  await runBrowserTest(async ({ browser, url }) => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.route("**/*", async (route) => {
      const requested = new URL(route.request().url());
      if (["http:", "https:"].includes(requested.protocol) && requested.origin !== new URL(url).origin) {
        report.externalRequests.push(requested.href);
        await route.abort();
      } else await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => report.errors.push({ case: currentCase, message: error.message }));
    try {
      await page.goto(url);
      await page.locator("#schematicMount svg").waitFor();
      currentCase = "quota-failure-clears-obsolete-archive";
      await loadAig(page, "old.blif");
      assert.equal(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).source.name, storageKey), "old.blif");
      // This is a real valid source below the 16 MiB import limit. The browser's
      // native storage quota fails without replacing Storage or the parser.
      await loadAig(page, "large.blif", `#${"x".repeat(6 * 1024 * 1024)}\n${source}`);
      assert.equal(await page.locator("#domainToolbar").isVisible(), true);
      assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), storageKey), null);
      const node = page.locator("#schematicMount [data-aig-node]").first();
      const nodeId = await node.getAttribute("data-aig-node");
      await node.focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction((nodeId) => document.querySelector("[data-aig-inspected-id]")?.dataset.aigInspectedId === nodeId, nodeId);
      assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), storageKey), null,
        "using the unsaved view must not revive the old archive");
      await page.locator("#toggleProcessLogButton").click();
      const quota = page.locator("#processLogList .level-warning").filter({ hasText: "Workspace could not be saved" });
      assert.equal(await quota.count(), 1, "repeated failed saves on one document share a warning");
      await quota.locator("summary").click();
      assert.match(await quota.locator("pre").innerText(), /aig.workspace.save/);
      const ready = page.waitForEvent("download");
      await page.locator("#exportProcessLogButton").click();
      const entries = (await readFile(await (await ready).path(), "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
      const warnings = entries.filter((row) => row.details?.operation === "aig.workspace.save");
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0].details.error.name, "QuotaExceededError");
      assert.ok(warnings[0].details.sessionId && warnings[0].details.viewScopeId && warnings[0].details.error.stack);
      assert.doesNotMatch(JSON.stringify(warnings), /x{50}/);
      await page.locator("#closeProcessLogButton").click();
      report.cases.push({ name: currentCase, status: "passed" });

      currentCase = "reload-does-not-restore-obsolete-aig";
      await page.reload();
      await page.locator("#schematicMount svg").waitFor();
      assert.equal(await page.locator("#domainToolbar").isVisible(), false);
      assert.equal(await page.evaluate((key) => sessionStorage.getItem(key), storageKey), null);
      assert.doesNotMatch(await page.locator("#statusBar").textContent(), /old\.blif/);
      report.cases.push({ name: currentCase, status: "passed" });

      currentCase = "later-small-source-can-save-and-restore";
      await loadAig(page, "recovered.blif");
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded recovered.blif"));
      assert.equal(await page.locator("#domainToolbar").isVisible(), true);
      assert.equal(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).source.name, storageKey), "recovered.blif");
      report.cases.push({ name: currentCase, status: "passed" });

      currentCase = "painted-wheel-preview-survives-immediate-reload";
      await page.waitForTimeout(200);
      await page.evaluate(async (storageKey) => {
        const canvas = document.querySelector("#canvas");
        const content = document.querySelector("#schematicContent");
        const inspect = () => {
          const box = canvas.getBoundingClientRect();
          const matrix = content.getScreenCTM();
          return { transform: content.getAttribute("transform"), physicalScale: Math.hypot(matrix.a, matrix.b),
            canvas: { x: box.x, y: box.y, width: box.width, height: box.height },
            storedViewport: JSON.parse(sessionStorage.getItem(storageKey)).viewport,
            interacting: canvas.classList.contains("is-view-interacting") };
        };
        const record = { before: inspect() };
        const started = performance.now();
        const box = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: box.x + box.width / 2,
          clientY: box.y + box.height / 2, bubbles: true, cancelable: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        record.preview = inspect();
        window.addEventListener("beforeunload", () => {
          // Registered after the app's listener, so this reads the archive
          // actually written for reload, before the 140 ms wheel settlement.
          record.unload = inspect();
          record.unload.elapsedMs = performance.now() - started;
          sessionStorage.setItem("aig-storage-wheel-observation", JSON.stringify(record));
        }, { once: true });
      }, storageKey);
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded recovered.blif"));
      await page.waitForTimeout(200);
      const observation = await page.evaluate((storageKey) => {
        const record = JSON.parse(sessionStorage.getItem("aig-storage-wheel-observation"));
        sessionStorage.removeItem("aig-storage-wheel-observation");
        const box = document.querySelector("#canvas").getBoundingClientRect();
        const content = document.querySelector("#schematicContent");
        const matrix = content.getScreenCTM();
        return { ...record, restored: { transform: content.getAttribute("transform"), physicalScale: Math.hypot(matrix.a, matrix.b),
          canvas: { x: box.x, y: box.y, width: box.width, height: box.height },
          storedViewport: JSON.parse(sessionStorage.getItem(storageKey)).viewport } };
      }, storageKey);
      assert.ok(observation.unload.elapsedMs < 140, "test must reload before the wheel settlement timer");
      assert.equal(observation.unload.interacting, true);
      assert.notEqual(observation.preview.transform, observation.before.transform, "wheel preview was painted");
      assert.ok(Math.abs(observation.preview.physicalScale - observation.before.physicalScale) > 0.01,
        "wheel must visibly change the scale before reload");
      assert.deepEqual(observation.preview.storedViewport, observation.before.storedViewport,
        "preview painting must not perform a high-frequency session save");
      assert.deepEqual(observation.restored.canvas, observation.preview.canvas, "compare the same physical canvas bounds");
      assert.ok(Math.abs(observation.restored.physicalScale - observation.preview.physicalScale) < 0.001,
        "reload must retain the visible wheel preview's physical scale");
      assert.deepEqual(observation.restored.storedViewport, observation.unload.storedViewport);
      report.cases.push({ name: currentCase, status: "passed", observation });
      assert.deepEqual(report.errors, []);
      assert.deepEqual(report.externalRequests, []);
    } catch (error) {
      await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }, { root, chromium, executablePath: process.env.NGB_CHROME });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = { case: currentCase, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await writeFile(join(artifacts, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, failure: report.failure, artifacts }));
}
