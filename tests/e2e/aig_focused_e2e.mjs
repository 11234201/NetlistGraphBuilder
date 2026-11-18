import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const example = await readFile(new URL("../../examples/aig_mapped_names.blif", import.meta.url), "utf8");
const text = example.replace(".inputs n0 n1", ".inputs n0 n1 island_input").replace(".outputs n3 n4", ".outputs n3 n4 island_output")
  .replace(".end", ".names island_input island_output\n1 1\n.end");
const key = "ngb.domain-workspace.v1";

await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1080 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.layoutTest = { hold: false, count: 0 };
    window.Worker = new Proxy(window.Worker, { construct(target, args) {
      const worker = Reflect.construct(target, args);
      if (!String(args[0]).includes("graphviz_worker.js")) return worker;
      const send = worker.postMessage.bind(worker);
      worker.postMessage = (data) => {
        window.layoutTest.count++;
        if (window.layoutTest.fail) throw new Error("Injected Focused layout failure", { cause: new Error("provider failure") });
        if (window.layoutTest.hold) window.layoutTest.release = () => send(data);
        else send(data);
      };
      return worker;
    } });
  });
  const archive = () => page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)), key);
  const waitRoots = async (count) => {
    await page.waitForFunction(({ key, count }) => JSON.parse(sessionStorage.getItem(key))?.focus?.focusedRootNodeIds.length === count &&
      document.querySelector("#cancelDomainImportButton").hidden, { key, count });
  };
  async function resultFor(term) {
    await page.locator("#searchInput").fill(term);
    const result = page.locator("#searchResults .search-result").filter({ hasText: term }).first();
    await result.waitFor();
    return result;
  }
  async function download(selector) {
    const ready = page.waitForEvent("download");
    await page.locator(selector).evaluate((element) => element.click());
    return readFile(await (await ready).path(), "utf8");
  }
  const nodeIds = () => page.locator("#schematicMount [data-aig-node]").evaluateAll((nodes) => nodes.map((n) => n.dataset.aigNode).sort());
  try {
    await page.goto(url);
    await page.locator("#aigFileInput").setInputFiles({ name: "focus.blif", mimeType: "text/plain", buffer: Buffer.from(text) });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded focus.blif"));
    const original = await nodeIds();
    await page.locator('[data-aig-nav-tab="analysis"]').click();
    await page.locator('[data-aig-analysis-status="complete"]').waitFor();
    assert.ok(await page.locator("[data-aig-analysis-select]").count() > 0, "Whole contains a proven reconvergence");
    await (await resultFor("in_96")).locator(".search-result-main").click();
    const firstRoot = (await archive()).selectedId;
    const originalCalls = await page.evaluate(() => { window.layoutTest.hold = true; return window.layoutTest.count; });
    await page.locator("#focusedViewButton").click();
    await page.waitForFunction((count) => window.layoutTest.count > count, originalCalls);
    await page.locator("#wholeViewButton").click();
    await waitRoots(0);
    assert.deepEqual(await nodeIds(), original, "Whole cancels a pending Focused layout");

    await page.locator("#focusedViewButton").click();
    await page.waitForFunction((count) => window.layoutTest.count > count + 1, originalCalls);
    await page.evaluate(() => { window.layoutTest.hold = false; });
    await (await resultFor("island_input")).locator(".search-result-add").click();
    await waitRoots(2);
    assert.ok((await archive()).focus.focusedRootNodeIds.includes(firstRoot), "rapid roots additions compose");
    await page.locator("#searchInput").fill("");
    await page.evaluate(() => {
      document.querySelector("#faninDepthInput").value = "0";
      const output = document.querySelector("#fanoutDepthInput");
      output.value = "0"; output.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).focus.fanoutDepth === 0, key);
    const zeros = await nodeIds();
    assert.deepEqual(zeros.filter((id) => !id.startsWith("cut:")), (await archive()).focus.focusedRootNodeIds);
    assert.ok(zeros.some((id) => id.startsWith("cut:")));
    await page.locator('[data-aig-nav-tab="analysis"]').click();
    await page.locator('[data-aig-analysis-status="complete"]').waitFor();
    assert.equal(await page.locator("[data-aig-analysis-select]").count(), 0, "hidden arms cannot form a Focused reconvergence");
    const island = await resultFor("island_output");
    assert.match(await island.textContent(), /Outside Focused/);
    await island.locator(".search-result-main").click();
    await waitRoots(3);
    const three = await nodeIds();
    await page.locator("#moduleBackButton").click(); await waitRoots(2);
    assert.deepEqual(await nodeIds(), zeros);
    await page.locator("#moduleForwardButton").click(); await waitRoots(3);
    assert.deepEqual(await nodeIds(), three);
    await page.locator('[data-domain-policy="viewStyle"]').selectOption("standard");
    await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).presentationPolicy.viewStyle === "standard", key);
    assert.deepEqual(await nodeIds(), three);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded focus.blif"));
    await waitRoots(3);
    assert.deepEqual(await nodeIds(), three);
    const svg = await download("#exportSvgButton");
    assert.deepEqual([...svg.matchAll(/data-aig-node="([^"]+)"/g)].map((m) => m[1]).sort(), three);
    await page.evaluate(() => {
      const nativeClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {
        HTMLAnchorElement.prototype.click = nativeClick;
        throw new Error("Injected AIG SVG download failure");
      };
      document.querySelector("#exportSvgButton").click();
    });
    const failedExport = page.locator("#processLogList .level-error").filter({ hasText: "Injected AIG SVG download failure" });
    await failedExport.locator("summary").click();
    assert.match(await failedExport.locator("pre").textContent(), /aig.svg.export/);
    await page.evaluate(() => {
      window.layoutTest.fail = true;
      const field = document.querySelector("#fanoutDepthInput");
      field.value = "2"; field.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const failure = page.locator("#processLogList .level-error").filter({ hasText: "Injected Focused layout failure" });
    await failure.locator("summary").click();
    assert.match(await failure.locator("pre").textContent(), /aig.focused.layout/);
    assert.deepEqual(await nodeIds(), three);
    assert.equal((await archive()).focus.fanoutDepth, 0);
    assert.equal(await page.locator("#fanoutDepthInput").inputValue(), "0");
    const rows = (await download("#exportProcessLogButton")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const exportErrors = rows.filter((row) => row.details?.operation === "aig.svg.export");
    assert.equal(exportErrors.length, 1);
    assert.equal(exportErrors[0].details.format, "svg");
    assert.ok(exportErrors[0].details.sessionId && exportErrors[0].details.error.stack);
    const failures = rows.filter((row) => row.details?.operation === "aig.focused.layout" && row.level === "error");
    assert.equal(failures.length, 1);
    const details = failures[0].details;
    assert.ok(details.sessionId && details.jobId && details.viewScopeId && details.visibleNodes && details.retainedPreviousView);
    assert.notEqual(details.previousScope, details.viewScopeId);
    assert.equal(details.error.cause.message, "provider failure");
    assert.match(details.error.stack, /Injected Focused layout failure/);
    await page.evaluate(() => { window.layoutTest.fail = false; });
    await page.locator("#wholeViewButton").click(); await waitRoots(0);
    assert.deepEqual(await nodeIds(), original);
    async function fresh(name) {
      await page.locator("#aigFileInput").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
      await page.waitForFunction((name) => document.querySelector("#statusBar").textContent.includes("Loaded " + name), name);
      await (await resultFor("in_96")).locator(".search-result-main").click();
    }
    async function holdNextLayout(action) {
      const count = await page.evaluate(() => { window.layoutTest.hold = true; return window.layoutTest.count; });
      await action();
      await page.waitForFunction((count) => window.layoutTest.count > count, count);
      await page.evaluate(() => { window.layoutTest.hold = false; });
    }
    const style = page.locator('[data-domain-policy="viewStyle"]');
    await fresh("focus_then_style.blif");
    await holdNextLayout(() => page.locator("#focusedViewButton").click());
    await style.selectOption("standard");
    await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).presentationPolicy.viewStyle === "standard", key);
    const focusThenStyle = await archive();

    await fresh("style_then_focus.blif");
    await holdNextLayout(() => style.selectOption("standard"));
    await page.locator("#focusedViewButton").click();
    await waitRoots(1);
    const styleThenFocus = await archive();

    await fresh("fast_history.blif");
    await page.locator("#focusedViewButton").click(); await waitRoots(1);
    await (await resultFor("island_input")).locator(".search-result-add").click(); await waitRoots(2);
    await page.evaluate(() => { const back = document.querySelector("#moduleBackButton"); back.click(); back.click(); });
    await page.waitForFunction(() => document.querySelector("#cancelDomainImportButton").hidden);
    const fastBack = await archive();
    await page.evaluate(() => { const next = document.querySelector("#moduleForwardButton"); next.click(); next.click(); });
    await page.waitForFunction(() => document.querySelector("#cancelDomainImportButton").hidden);
    const fastForward = await archive();

    assert.deepEqual({
      focusThenStyle: [focusThenStyle.focus.focusedRootNodeIds.length, focusThenStyle.presentationPolicy.viewStyle],
      styleThenFocus: [styleThenFocus.focus.focusedRootNodeIds.length, styleThenFocus.presentationPolicy.viewStyle],
      fastBackRoots: fastBack.focus.focusedRootNodeIds.length,
      fastForwardRoots: fastForward.focus.focusedRootNodeIds.length
    }, { focusThenStyle: [1, "standard"], styleThenFocus: [1, "standard"], fastBackRoots: 0, fastForwardRoots: 2 });
    await fresh("pending_selection.blif");
    await holdNextLayout(() => page.locator("#focusedViewButton").click());
    await (await resultFor("w_gen_5291")).locator(".search-result-main").click();
    const laterSelection = (await archive()).selectedId;
    await page.evaluate(() => window.layoutTest.release());
    await waitRoots(1);
    const selectedAfterLayout = (await archive()).selectedId;
    assert.ok((await nodeIds()).includes(laterSelection), "the more recent selection is in the committed Focused scope");

    // Restore a real, valid 520-load fanout directly into its bounded view.
    // A second init script runs before the application opens the saved document.
    await page.addInitScript((key) => {
      const local = JSON.parse(sessionStorage.getItem(key));
      const names = Array.from({ length: 520 }, (_, index) => "out" + index);
      local.source = { name: "budget.blif", text: ".model budget\n.inputs a\n.outputs " + names.join(" ") + "\n" +
        names.map((name) => ".names a " + name + "\n1 1").join("\n") + "\n.end" };
      local.focus = { viewMode: "focused", focusedRootNodeIds: ["n1", "stale"], activeFocusedRootNodeId: "stale", faninDepth: 0, fanoutDepth: 1 };
      local.selectedId = "stale";
      sessionStorage.setItem(key, JSON.stringify(local));
    }, key);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded budget.blif"));
    const budgetStatus = await page.locator("#statusBar").textContent();
    await style.selectOption("standard");
    await page.waitForFunction((key) => JSON.parse(sessionStorage.getItem(key)).presentationPolicy.viewStyle === "standard", key);
    const budgetLog = (await download("#exportProcessLogButton")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const partialOnRestore = budgetLog.filter((row) => row.details?.code === "aig.focused.partial");
    assert.deepEqual({ selectedAfterLayout, partialWarnings: partialOnRestore.length, budgetStatus: /budget reached/.test(budgetStatus) },
      { selectedAfterLayout: laterSelection, partialWarnings: 1, budgetStatus: true });
    assert.equal(partialOnRestore[0].details.hiddenEndpointCount, 9);
    const staleRoots = budgetLog.filter((row) => row.details?.code === "aig.focused.stale-roots");
    assert.equal(staleRoots.length, 1);
    assert.deepEqual([staleRoots[0].details.requestedCount, staleRoots[0].details.restoredCount], [2, 1]);
    assert.equal((await archive()).focus.activeFocusedRootNodeId, "n1");
    assert.equal((await archive()).selectedId, null);
    assert.deepEqual(errors, []);
    console.log("AIG Focused search/rapid changes/depth/undo/redo/restore/SVG/failure JSONL passed");
  } finally { await page.close(); }
}, { root, chromium, executablePath: process.env.NGB_CHROME });
