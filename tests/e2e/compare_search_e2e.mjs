import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const artifacts = resolve(process.env.NGB_COMPARE_SEARCH_ARTIFACT_DIR || join(root, "dc_runs", `compare-search-${Date.now()}`));
const baseline = process.env.NGB_COMPARE_SEARCH_BASELINE === "1";
const report = { provider: DEFAULT_LAYOUT_PROVIDER_ID, baseline, cases: [], errors: [] };
await mkdir(artifacts, { recursive: true });
const file = (name, source) => ({ name, mimeType: "text/plain", buffer: Buffer.from(source) });
const largeModule = (name) => `module ${name}(input p,output y); wire ${Array.from({ length: 519 }, (_, index) => `n${index}`).join(",")};\n` +
  Array.from({ length: 520 }, (_, index) => `BUF large_${index}(.A(${index ? `n${index - 1}` : "p"}),.Y(${index === 519 ? "y" : `n${index}`}));`).join("\n") + "\nendmodule";
const pairSource = [
  ...Array.from({ length: 32 }, (_, index) => `module noise_${index}(input a,output z); BUF shared(.A(a),.Y(z)); endmodule`),
  `module left_mod(input p,branch,output y,other); wire n;
    BUF shared(.A(p),.Y(n)); BUF a_only(.A(n),.Y(y)); BUF isolated(.A(branch),.Y(other)); endmodule`,
  `module right_mod(input p,branch,output y,other); wire n;
    BUF shared(.A(p),.Y(n)); BUF b_only(.A(n),.Y(y)); BUF isolated(.A(branch),.Y(other)); endmodule`,
  `module spare_mod(input p,output y); BUF spare_only(.A(p),.Y(y)); endmodule`,
  largeModule("large_left"), largeModule("large_right")
].join("\n");

async function reveal(locator) {
  const parents = locator.locator("xpath=ancestor::details");
  for (let index = 0; index < await parents.count(); index++) {
    const parent = parents.nth(index);
    if (!await parent.evaluate((element) => element.open)) await parent.locator(":scope > summary").click();
  }
}
async function click(page, selector) { const target = page.locator(selector); await reveal(target); await target.click(); }
async function frames(page) { await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function applyPair(page, left = "left_mod", right = "right_mod") {
  if (!await page.locator("#compareMount").isVisible()) await click(page, "#compareButton");
  await page.locator("#leftModuleSelect").selectOption(left);
  await page.locator("#rightModuleSelect").selectOption(right);
  await click(page, "#applyCompareButton");
  await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Compare ready"));
  await frames(page);
}
async function rows(page, term) {
  await page.locator("#searchInput").fill(term);
  await page.locator(".search-result").first().waitFor();
  return page.locator(".search-result").evaluateAll((elements) => elements.map((element) => ({
    label: element.querySelector(".search-result-label")?.textContent,
    kind: element.querySelector(".search-result-kind")?.textContent,
    context: element.querySelector(".search-result-context")?.textContent,
    side: element.dataset.searchSide || element.querySelector("[data-search-side]")?.dataset.searchSide || null
  })));
}
async function search(page, term, side, kind = "instance", keyboard = false) {
  await rows(page, term);
  const matches = page.locator(".search-result").filter({ has: page.locator(".search-result-label", { hasText: new RegExp(`^${term}$`) }) })
    .filter({ has: page.locator(".search-result-kind", { hasText: new RegExp(`${kind}$`) }) });
  const row = matches.filter({ has: page.locator(`[data-search-side="${side}"]`) });
  // The side attribute belongs to the row and/or its main button. Match the
  // button directly to avoid depending on the precise markup wrapper.
  const main = row.locator("[data-search-index]").first();
  if (keyboard) {
    const selectedIndex = Number(await main.getAttribute("data-search-index"));
    for (let index = 0; index < selectedIndex; index++) await page.locator("#searchInput").press("ArrowDown");
    await page.locator("#searchInput").press("Enter");
  } else await main.click();
  await page.waitForFunction(() => document.querySelector("#searchResults").hidden);
  await frames(page);
}
async function settings(page, { selection = false, roots = false } = {}) {
  for (const [selector, checked] of [["#syncCompareInput", false], ["#syncCompareSelectionInput", selection], ["#syncCompareFocusInput", roots]]) {
    const input = page.locator(selector); await reveal(input); await input.setChecked(checked);
  }
  await page.keyboard.press("Escape");
}
async function focused(page, side = "left") {
  await search(page, "shared", side);
  await click(page, "#setFocusedRootButton");
  await page.locator(`#${side}SchematicMount .focused-root[data-node-id="cell:shared"]`).waitFor();
  await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Compare ready"));
}
async function expectCentered(page, side, id) {
  const node = await page.locator(`#${side}SchematicMount [data-node-id="${id}"] .node-shape`).first().boundingBox();
  const svg = await page.locator(`#${side}SchematicMount svg`).boundingBox();
  assert.ok(node && svg);
  assert.ok(Math.hypot(node.x + node.width / 2 - svg.x - svg.width / 2, node.y + node.height / 2 - svg.y - svg.height / 2) < 2, `${side} centers ${id}`);
}
async function selectedScope(page, prefix) {
  await page.waitForFunction((expected) => document.querySelector(".inspector-object-scope")?.textContent?.startsWith(expected), prefix);
  return page.locator(".inspector-object-scope").textContent();
}
async function geometry(page) {
  return page.locator("#compareMount").evaluate((mount) => [...mount.querySelectorAll("[data-node-id], .wire")].map((element) =>
    [element.getAttribute("data-node-id"), element.getAttribute("transform"), element.getAttribute("d")]));
}
async function downloadLog(page) {
  if (!await page.locator("#processLogList").isVisible()) await click(page, "#toggleProcessLogButton");
  const pending = page.waitForEvent("download");
  await page.locator("#exportProcessLogButton").click();
  const download = await pending;
  return (await readFile(await download.path(), "utf8")).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

let currentCase = "startup";
try {
  await runBrowserTest(async ({ browser, url }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => report.errors.push({ case: currentCase, message: error.message }));
    let workers = 0;
    page.on("worker", () => workers++);
    const test = async (name, action) => { currentCase = name; const start = Date.now(); const detail = await action(); report.cases.push({ name, durationMs: Date.now() - start, ...detail }); };
    try {
      await page.goto(url);
      assert.equal(await page.locator("#layoutProviderSelect").inputValue(), DEFAULT_LAYOUT_PROVIDER_ID);
      await page.locator("#fileInput").setInputFiles(file("search-pair.v", pairSource));
      await page.locator('#schematicMount [data-node-id="cell:shared"]').waitFor();
      await applyPair(page);
      if (baseline) {
        const limited = await rows(page, "shared");
        await rows(page, "a_only");
        await page.locator(".search-result [data-search-index]").first().click();
        await frames(page);
        await page.waitForTimeout(500);
        report.baselineEvidence = { limited,
          appliedPairMissing: !limited.some((row) => /left_mod|right_mod/.test(row.context)),
          compareVisibleAfterClick: await page.locator("#compareMount").isVisible(),
          scope: await page.evaluate(() => document.querySelector(".inspector-object-scope")?.textContent || null),
          singleSelected: await page.locator('#schematicMount [data-node-id="cell:a_only"].is-selected').count(),
          leftSelected: await page.locator('#leftSchematicMount [data-node-id="cell:a_only"].is-selected').count(),
          status: await page.locator("#statusBar").textContent() };
        assert.equal(report.baselineEvidence.appliedPairMissing, true, "baseline must reproduce pre-scope truncation");
        assert.equal(report.baselineEvidence.leftSelected, 0, "baseline must reproduce Compare search failing to select the owning canvas");
        await page.screenshot({ path: join(artifacts, "baseline.png") });
        return;
      }
      await test("scope precedes the global result limit; applied A/B side labels", async () => {
        const found = await rows(page, "shared");
        assert.equal(found.length, 2);
        assert.deepEqual(found.map((row) => row.side).sort(), ["left", "right"]);
        assert.deepEqual(found.map((row) => row.kind).sort(), ["A · instance", "B · instance"]);
        assert.ok(found.every((row) => /left_mod|right_mod/.test(row.context)));
        await page.locator("#rightModuleSelect").selectOption("spare_mod");
        assert.deepEqual(await rows(page, "shared"), found, "draft selectors must not change the applied search pair");
        await page.locator("#rightModuleSelect").selectOption("right_mod");
        return { rows: found };
      });
      await test("same-name cell/net/port and Enter target the owning side without layout", async () => {
        const before = await geometry(page), workerCount = workers;
        await settings(page);
        await search(page, "shared", "right");
        await selectedScope(page, "B · Compare · right_mod");
        assert.equal(await page.locator('#rightSchematicMount [data-node-id="cell:shared"].is-selected').count(), 1);
        assert.equal(await page.locator("#leftSchematicMount .is-selected").count(), 0);
        await search(page, "shared", "left", "instance", true);
        await selectedScope(page, "A · Compare · left_mod");
        await search(page, "n", "right", "net");
        await selectedScope(page, "B · Compare · right_mod");
        await search(page, "p", "left", "port", true);
        await selectedScope(page, "A · Compare · left_mod");
        assert.equal(await page.locator('#leftSchematicMount [data-node-id="input:p"].is-selected').count(), 1);
        assert.deepEqual(await geometry(page), before, "visible Whole hits preserve the positioned graph");
        assert.equal(workers, workerCount, "visible Whole hits must not start layout workers");
      });
      await test("selection sync independently centers the matching side", async () => {
        await settings(page, { selection: false });
        await click(page, "#fitButton");
        const left = await page.locator("#leftSchematicMount .schematic-content").getAttribute("transform");
        await search(page, "shared", "right");
        await expectCentered(page, "right", "cell:shared");
        assert.equal(await page.locator("#leftSchematicMount .schematic-content").getAttribute("transform"), left);
        await settings(page, { selection: true });
        await click(page, "#fitButton");
        await search(page, "shared", "right", "instance", true);
        await expectCentered(page, "right", "cell:shared");
        await expectCentered(page, "left", "cell:shared");
        assert.equal(await page.locator("#leftSchematicMount .is-compare-counterpart").getAttribute("data-node-id"), "cell:shared");
      });
      await test("Focused search reveals its side and history restores the prior roots", async () => {
        await settings(page, { roots: true });
        await focused(page);
        assert.equal(await page.locator('#leftSchematicMount [data-node-id="cell:isolated"]').count(), 0);
        assert.equal(await page.locator('#rightSchematicMount [data-node-id="cell:isolated"]').count(), 0);
        await settings(page, { roots: false });
        await search(page, "isolated", "left");
        await page.locator('#leftSchematicMount .focused-root[data-node-id="cell:isolated"]').waitFor();
        await selectedScope(page, "A · Compare · left_mod");
        assert.equal(await page.locator('#rightSchematicMount [data-node-id="cell:isolated"]').count(), 0);
        await click(page, "#moduleBackButton");
        await page.waitForFunction(() => !document.querySelector('#leftSchematicMount [data-node-id="cell:isolated"]'));
        assert.equal(await page.locator('#leftSchematicMount .focused-root[data-node-id="cell:shared"]').count(), 1);
        await click(page, "#moduleForwardButton");
        await page.locator('#leftSchematicMount .focused-root[data-node-id="cell:isolated"]').waitFor();
        await click(page, "#moduleBackButton");
        await page.waitForFunction(() => !document.querySelector('#leftSchematicMount [data-node-id="cell:isolated"]'));
        await settings(page, { roots: true });
        await search(page, "isolated", "right");
        await page.locator('#rightSchematicMount .focused-root[data-node-id="cell:isolated"]').waitFor();
        await page.locator('#leftSchematicMount .focused-root[data-node-id="cell:isolated"]').waitFor();
        await selectedScope(page, "B · Compare · right_mod");
      });
      await test("pair changes invalidate an open result list", async () => {
        await rows(page, "b_only");
        await applyPair(page, "left_mod", "spare_mod");
        // Enter with the old popup closed must not revive the previously applied B.
        await page.locator("#searchInput").press("Enter");
        await frames(page);
        assert.equal(await page.locator('#rightSchematicMount [data-node-id="cell:spare_only"]').count(), 1);
        assert.equal(await page.locator('#rightSchematicMount [data-node-id="cell:b_only"]').count(), 0);
        const found = await rows(page, "spare_only");
        assert.equal(found.length, 1); assert.equal(found[0].side, "right");
        await search(page, "spare_only", "right");
        await selectedScope(page, "B · Compare · spare_mod");
        await applyPair(page);
      });
      await test("delayed old Add as start/end events cannot leave the applied pair", async () => {
        await rows(page, "b_only");
        const row = page.locator('.search-result[data-search-side="right"]');
        await row.locator("[data-search-actions]").click();
        // Dismiss the popover before reaching the Apply control beneath it.
        await page.locator("#searchInput").press("Escape");
        const buttons = await row.locator("[data-search-path]").elementHandles();
        assert.equal(buttons.length, 2);
        await applyPair(page, "left_mod", "spare_mod");
        const single = await page.locator("#schematicMount").innerHTML(), before = await geometry(page);
        for (const button of buttons) {
          // Deliver a queued action from the actual old menu after Apply hides
          // it. The production DOM listener, path adapter and workspace run
          // unchanged; no controller or state object is mocked.
          assert.equal(await button.evaluate((element) => element.isConnected), true);
          await button.evaluate((element) => element.click());
          await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Search scope changed"));
          await frames(page);
          assert.equal(await page.locator("#compareMount").isVisible(), true);
          assert.equal(await page.locator("#schematicMount").innerHTML(), single);
          assert.deepEqual(await geometry(page), before);
          assert.doesNotMatch(await page.locator("#pathDraft").textContent(), /b_only/);
        }
        await applyPair(page);
      });
      await test("Show Path rejects an outside hit and retains endpoint actions", async () => {
        await settings(page);
        if (!await page.locator("#pathPanel").isVisible()) await click(page, "#showPathButton");
        await page.locator("#pathSide").selectOption("left");
        for (const [term, direction, match] of [["input:p", "starts", /p · input/], ["output:y", "ends", /y · output/]]) {
          await page.locator("#pathFind").fill(term);
          await page.locator("#pathCandidates .path-row").filter({ hasText: match }).first().locator(`[data-path-action="${direction}"]`).click();
        }
        await page.locator('#pathPanel [data-path-action="apply"]').click();
        await page.waitForFunction(() => document.querySelector("#pathPanel").hasAttribute("data-enabled") && document.querySelector('#pathPanel [data-path-action="cancel"]').hidden);
        assert.equal(await page.locator('#leftSchematicMount [data-node-id="cell:isolated"]').count(), 0);
        const before = await geometry(page);
        await search(page, "isolated", "left");
        assert.match(await page.locator("#statusBar").textContent(), /Outside Show Path/);
        assert.deepEqual(await geometry(page), before);
        await rows(page, "isolated");
        const row = page.locator('.search-result').filter({ has: page.locator('[data-search-side="left"]') });
        await row.locator("[data-search-actions]").click();
        await row.locator('[data-search-path="ends"]').click();
        await page.waitForFunction(() => document.querySelector("#pathDraft").textContent.includes("isolated"));
        assert.equal(await page.locator("#compareMount").isVisible(), true);
        await page.locator('#pathPanel [data-path-action="clear"]').click();
      });
      await test("failed search reveal retains both views and logs the original error once", async () => {
        await settings(page, { roots: true });
        await focused(page);
        await settings(page);
        const before = await geometry(page);
        await page.evaluate(() => {
          window.searchPreviousViews = [document.querySelector("#leftSchematicMount").firstChild, document.querySelector("#rightSchematicMount").firstChild];
          const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
          Object.defineProperty(Element.prototype, "innerHTML", { ...descriptor, set(value) {
            if (!this.isConnected && String(value).trimStart().startsWith("<svg")) {
              Object.defineProperty(Element.prototype, "innerHTML", descriptor);
              throw new Error("injected Compare search candidate render", { cause: new Error("injected search render cause") });
            }
            return descriptor.set.call(this, value);
          } });
        });
        await search(page, "isolated", "left");
        await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("injected Compare search candidate render"));
        assert.deepEqual(await geometry(page), before);
        assert.equal(await page.evaluate(() => window.searchPreviousViews.every((view, index) => view === document.querySelector(index ? "#rightSchematicMount" : "#leftSchematicMount").firstChild)), true);
        assert.equal(await page.locator('#leftSchematicMount [data-node-id="cell:isolated"]').count(), 0);
        if (!await page.locator("#processLogList").isVisible()) await click(page, "#toggleProcessLogButton");
        const entry = page.locator("#processLogList li").filter({ hasText: "Compare search failed" }).last();
        await entry.locator("summary").click();
        const details = await entry.locator("pre").textContent();
        assert.match(details, /injected Compare search candidate render/);
        assert.match(details, /injected search render cause/);
        const logs = await downloadLog(page);
        const failures = logs.filter((item) => item.details?.error?.message === "injected Compare search candidate render");
        assert.equal(failures.length, 1);
        assert.equal(failures[0].details.operation, "search.compare.navigate");
        assert.equal(failures[0].details.code, "search.compare.failed");
        assert.equal(failures[0].details.side, "left");
        assert.equal(failures[0].details.moduleName, "left_mod");
        assert.ok(failures[0].details.documentId);
        assert.equal(typeof failures[0].details.documentRevision, "number");
        assert.equal(failures[0].details.retainedPreviousView, true);
        assert.match(failures[0].details.error.stack, /injected Compare search candidate render/);
        assert.equal(failures[0].details.error.cause.message, "injected search render cause");
        await writeFile(join(artifacts, "process-log.jsonl"), logs.map((item) => JSON.stringify(item)).join("\n") + "\n");
        await click(page, "#toggleProcessLogButton");
        await search(page, "isolated", "left");
        await page.locator('#leftSchematicMount .focused-root[data-node-id="cell:isolated"]').waitFor();
        await selectedScope(page, "A · Compare · left_mod");
        return { diagnostic: failures[0].details };
      });
      await test("Search-first reveals only the requested side until root sync is enabled", async () => {
        await applyPair(page, "large_left", "large_right");
        await page.locator("#leftSchematicMount .search-first-empty").waitFor();
        await page.locator("#rightSchematicMount .search-first-empty").waitFor();
        await settings(page);
        await search(page, "large_250", "right");
        await page.locator('#rightSchematicMount .focused-root[data-node-id="cell:large_250"]').waitFor();
        await selectedScope(page, "B · Compare · large_right");
        assert.equal(await page.locator("#leftSchematicMount .search-first-empty").count(), 1);
        assert.ok(await page.locator("#rightSchematicMount .node").count() < 30, "Search-first lays out the bounded neighborhood");
        await settings(page, { roots: true });
        await search(page, "large_450", "left", "instance", true);
        await page.locator('#leftSchematicMount .focused-root[data-node-id="cell:large_450"]').waitFor();
        await page.locator('#rightSchematicMount .focused-root[data-node-id="cell:large_450"]').waitFor();
        await selectedScope(page, "A · Compare · large_left");
      });
      assert.deepEqual(report.errors, []);
      await page.screenshot({ path: join(artifacts, "compare-search.png") });
    } catch (error) {
      report.failure = { case: currentCase, message: error.message, stack: error.stack, body: await page.locator("body").innerText() };
      await page.screenshot({ path: join(artifacts, "failure.png") });
      throw error;
    } finally { await context.close(); }
  }, { root, chromium, executablePath: process.env.NGB_CHROME_BINARY || process.env.NGB_CHROME });
} finally {
  await writeFile(join(artifacts, "report.json"), JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ ok: true, provider: report.provider, cases: report.cases.length, baseline, artifacts }));
