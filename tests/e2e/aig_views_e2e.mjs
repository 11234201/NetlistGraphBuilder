import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";
import { importAigSource } from "../../src/domains/aig/aig_import.js";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const artifacts = join(root, "dc_runs/aig_views_browser");
await mkdir(artifacts, { recursive: true });
const text = await readFile(new URL("../fixtures/aig/shared_cone.blif", import.meta.url), "utf8");
const { model } = importAigSource(text, { name: "views.blif" });
const and = model.nodes.find((node) => node.kind === "and" && model.edges.some((edge) => edge.source === node.id));
const expected = {};
for (const edge of model.edges) {
  if (edge.target === and.id) { expected[edge.id] = "input"; expected[edge.source] = "input"; }
  if (edge.source === and.id) { expected[edge.id] = "output"; expected[edge.target] = "output"; }
}
const roles = (page) => page.locator("#schematicMount [data-neighbor-role]").evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
  if (![...element.querySelectorAll(".aig-neighbor-halo")].every((halo) => halo.getAttribute("visibility") === "visible")) throw new Error("Invisible neighbor");
  return [element.dataset.aigObject, element.dataset.neighborRole];
})));
const geometry = (page) => page.locator("#schematicMount").evaluate((mount) => [...mount.querySelectorAll(".aig-node-shape,.aig-edge-path")].map((shape) => ({
  id: shape.parentElement.dataset.aigObject,
  geometry: ["d", "points", "cx", "cy", "rx", "ry"].map((key) => shape.getAttribute(key))
})));
const appearance = (page) => page.locator("#schematicMount").evaluate((mount) => [...mount.querySelectorAll(".aig-node-shape,.aig-edge-path,.aig-edge-arrow,.aig-node-label")]
  .map((shape) => [shape.parentElement.dataset.aigObject, shape.tagName, shape.getAttribute("class"),
    ...["fill", "stroke", "stroke-width", "stroke-dasharray", "font-family", "font-size"].map((key) => shape.getAttribute(key))])
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
const archive = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("ngb.domain-workspace.v1")));
const calls = (page) => page.evaluate(() => window.__viewTest.calls);
const cases = [];

await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__viewTest = { calls: 0, hold: false, fail: false };
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, { construct(target, args) {
      const worker = Reflect.construct(target, args);
      if (String(args[0]).includes("graphviz_worker.js")) {
        const send = worker.postMessage.bind(worker);
        worker.postMessage = (...values) => {
          window.__viewTest.calls++;
          if (window.__viewTest.fail) throw new Error("Test layout failure");
          if (window.__viewTest.hold) { window.__viewTest.release = () => send(...values); return; }
          return send(...values);
        };
      }
      return worker;
    } });
  });
  try {
    await page.goto(url);
    await page.locator("#aigFileInput").setInputFiles({ name: "views.blif", mimeType: "text/plain", buffer: Buffer.from(text) });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded views.blif"));
    const style = page.locator('[data-domain-policy="viewStyle"]');
    const neighbors = page.locator('[data-domain-policy="neighbors"]');
    assert.equal(await style.inputValue(), "standard");
    assert.equal(await neighbors.isChecked(), true);
    const beforeGeometry = await geometry(page);
    const beforeAppearance = await appearance(page);
    const beforeCalls = await calls(page);
    await page.evaluate(() => { window.__oldAigSvg = document.querySelector("#schematicMount svg"); });
    await page.locator(`[data-aig-node="${and.id}"]`).click();
    assert.deepEqual(await roles(page), expected);
    await page.evaluate(() => {
      window.__unrelatedStyleWrites = 0;
      window.__styleObserver = new MutationObserver((records) => {
        window.__unrelatedStyleWrites += records.filter((record) => record.target.matches(".aig-node-shape,.aig-edge-path,.aig-edge-arrow")).length;
      });
      window.__styleObserver.observe(document.querySelector("#schematicMount"), { attributes: true, subtree: true });
    });
    await neighbors.uncheck();
    assert.deepEqual(await roles(page), {});
    await neighbors.check();
    assert.deepEqual(await roles(page), expected);
    assert.equal(await page.evaluate(() => {
      window.__styleObserver.disconnect(); return window.__unrelatedStyleWrites;
    }), 0, "the neighbor toggle cannot rewrite unrelated base shapes or edges");
    assert.equal(await calls(page), beforeCalls);
    assert.equal(await page.evaluate(() => window.__oldAigSvg === document.querySelector("#schematicMount svg")), true);
    assert.deepEqual(await geometry(page), beforeGeometry);
    cases.push("default Standard and one-hop highlights update without layout or replacing SVG");

    await page.evaluate(() => { window.__viewTest.hold = true; window.__viewTest.release = null; });
    await style.focus();
    await style.selectOption("abc");
    await page.waitForFunction(() => Boolean(window.__viewTest.release));
    assert.equal(await style.isEnabled(), true, "the view selector stays usable during a layout");
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.domainPolicy), "viewStyle");
    await style.selectOption("standard");
    assert.equal(await style.inputValue(), "standard");
    assert.equal(await page.locator("#cancelDomainImportButton").evaluate((button) => button.hidden), true);
    await page.evaluate(() => { window.__viewTest.release(); });
    assert.deepEqual(await geometry(page), beforeGeometry);
    assert.deepEqual(await roles(page), expected);
    cases.push("choosing the active style cancels a pending layout without losing keyboard focus");

    await page.evaluate(() => { window.__viewTest.hold = true; window.__viewTest.release = null; });
    await style.selectOption("abc");
    await page.waitForFunction(() => Boolean(window.__viewTest.release));
    for (const menu of await page.locator("#cancelDomainImportButton").locator("xpath=ancestor::details").all()) {
      if (!await menu.evaluate((element) => element.open)) await menu.locator(":scope > summary").click();
    }
    await page.locator("#cancelDomainImportButton").click();
    assert.equal(await style.inputValue(), "standard");
    assert.deepEqual(await geometry(page), beforeGeometry);
    assert.equal((await archive(page)).presentationPolicy.viewStyle, "standard");
    await page.evaluate(() => { window.__viewTest.hold = false; window.__viewTest.release(); window.__viewTest.fail = true; });
    await style.selectOption("abc");
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Test layout failure"));
    assert.equal(await style.inputValue(), "standard");
    assert.deepEqual(await roles(page), expected);
    assert.deepEqual(await geometry(page), beforeGeometry);
    await page.evaluate(() => { window.__viewTest.fail = false; });
    cases.push("cancelled and failed style changes keep the old graph, policy and selection");

    const switchStyle = async (value) => {
      await style.focus();
      await style.selectOption(value);
      await page.waitForFunction((value) => document.querySelector("#statusBar").textContent === `AIG view: ${value === "abc" ? "ABC" : "Standard"}`, value);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.domainPolicy), "viewStyle", "keyboard focus survives the view commit");
    };
    await page.locator("#searchInput").fill("shared");
    await page.locator("#searchResults [data-search-index]").first().waitFor();
    await page.evaluate(() => {
      window.__styleControl = document.querySelector('[data-domain-policy="viewStyle"]');
      window.__viewTest.hold = true; window.__viewTest.release = null;
    });
    await style.selectOption("abc");
    await page.waitForFunction(() => Boolean(window.__viewTest.release));
    await page.locator(`[data-aig-node="${and.id}"]`).press("Enter");
    await page.evaluate(() => { window.__viewTest.hold = false; window.__viewTest.release(); });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent === "AIG view: ABC");
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.domainObject), and.id,
      "a node focused while layout is pending keeps keyboard focus in the new SVG");
    assert.equal(await page.locator("#searchInput").inputValue(), "shared");
    assert.equal(await page.evaluate(() => window.__styleControl === document.querySelector('[data-domain-policy="viewStyle"]')), true);
    const abcGeometry = await geometry(page);
    assert.notDeepEqual(abcGeometry, beforeGeometry);
    assert.deepEqual(abcGeometry.map((item) => item.id).sort(), beforeGeometry.map((item) => item.id).sort());
    assert.deepEqual(await roles(page), expected);
    assert.equal((await archive(page)).selectedId, and.id);
    assert.equal(await page.locator("[data-aig-node] text").first().getAttribute("font-family"), "Arial");
    assert.ok(await page.locator('.aig-edge-path[stroke-dasharray="5 4"]').count() > 0);
    assert.deepEqual(await appearance(page), beforeAppearance);
    await page.screenshot({ path: join(artifacts, "abc-selected.png") });
    const afterAbc = await calls(page);
    await switchStyle("standard");
    assert.deepEqual(await geometry(page), beforeGeometry);
    await page.screenshot({ path: join(artifacts, "standard-selected.png") });
    await switchStyle("abc");
    assert.equal(await calls(page), afterAbc, "round trips use both cached layouts");
    assert.equal(await page.locator("#searchInput").inputValue(), "shared");
    cases.push("ABC changes layout while preserving colors, fonts, line styles, identities and selection, and caches round trips");

    const downloaded = page.waitForEvent("download");
    const exportButton = page.locator("#exportSvgButton");
    for (const menu of await exportButton.locator("xpath=ancestor::details").all()) {
      if (!await menu.evaluate((element) => element.open)) await menu.locator(":scope > summary").click();
    }
    await exportButton.click();
    const download = await downloaded;
    const svg = await readFile(await download.path(), "utf8");
    assert.match(svg, /Arial/);
    assert.doesNotMatch(svg, /Times-Roman/);
    assert.match(svg, /data-neighbor-role="input"/);
    assert.match(svg, /data-neighbor-role="output"/);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded views.blif"));
    assert.equal(await style.inputValue(), "abc");
    assert.deepEqual(await geometry(page), abcGeometry);
    assert.deepEqual(await roles(page), expected);
    cases.push("SVG export and reload retain style, selection and neighbor highlighting");

    await page.locator("#canvas").click({ position: { x: 5, y: 5 } });
    assert.deepEqual(await roles(page), {});
    assert.equal((await archive(page)).selectedId, null);
    await page.locator("#fileInput").setInputFiles({ name: "netlist.v", mimeType: "text/plain",
      buffer: Buffer.from("module top(input a,b,output y); AND2 u1 (.A(a),.B(b),.Y(y)); endmodule") });
    await page.locator('[data-node-id="cell:u1"]').waitFor();
    assert.equal(await page.locator("#domainToolbar").isVisible(), false);
    assert.equal(await page.locator("#schematicMount .aig-neighbor-halo").count(), 0);
    assert.equal(await archive(page), null);
    cases.push("blank click clears highlights; Netlist retains its own behavior");

    const outputs = Array.from({ length: 150 }, (_, i) => `output_${i}`);
    const ports = `.model scroll\n.inputs a\n.outputs ${outputs.join(" ")}\n${outputs.map((name) => `.names a ${name}\n1 1`).join("\n")}\n.end`;
    await page.locator("#aigFileInput").setInputFiles({ name: "scroll.blif", mimeType: "text/plain", buffer: Buffer.from(ports) });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded scroll.blif"));
    await page.locator('[data-aig-nav-tab="objects"]').click();
    const scrollBefore = await page.locator("#navigatorPanel").evaluate((panel) => { panel.scrollTop = 400; return panel.scrollTop; });
    assert.ok(scrollBefore > 0, "the fixture must exercise a scrolled sidebar");
    await page.evaluate(() => { window.__retainedNavigator = document.querySelector('[data-aig-filter="query"]'); });
    await switchStyle("abc");
    assert.equal(await page.locator("#navigatorPanel").evaluate((panel) => panel.scrollTop), scrollBefore);
    assert.equal(await page.evaluate(() => window.__retainedNavigator.isConnected), true);
    cases.push("same-document layout preserves the navigator scroll position");

    await page.locator("#aigFileInput").setInputFiles({ name: "composition.blif", mimeType: "text/plain",
      buffer: Buffer.from(".model composition\n.inputs 雪\n.outputs y\n.names 雪 y\n1 1\n.end") });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded composition.blif"));
    await page.locator('[data-aig-nav-tab="objects"]').click();
    await page.evaluate(() => { window.__viewTest.hold = true; window.__viewTest.release = null; });
    await style.selectOption("abc");
    await page.waitForFunction(() => Boolean(window.__viewTest.release));
    const query = page.locator('[data-aig-filter="query"]');
    await query.focus();
    await query.evaluate((input) => { window.__composingInput = input; });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "雪", selectionStart: 1, selectionEnd: 1 });
    await page.evaluate(() => { window.__viewTest.hold = false; window.__viewTest.release(); });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent === "AIG view: ABC");
    assert.equal(await page.evaluate(() => window.__composingInput.isConnected), true,
      "a completed layout cannot replace the input during an IME composition");
    assert.equal(await page.evaluate(() => document.activeElement === window.__composingInput), true);
    await cdp.send("Input.insertText", { text: "雪" });
    assert.equal(await query.inputValue(), "雪");
    assert.equal((await archive(page)).panels.navigator.query, "雪");
    assert.match(await page.locator("#domainNavigator").innerText(), /1 objects/);
    await cdp.detach();
    cases.push("layout completion preserves an in-progress IME composition and its final filter");
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, "report.json"), JSON.stringify({ cases, errors }, null, 2));
    console.log(JSON.stringify({ cases, errors, artifacts }));
  } catch (error) {
    await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
    throw error;
  }
}, { root, chromium, executablePath: process.env.NGB_CHROME });
