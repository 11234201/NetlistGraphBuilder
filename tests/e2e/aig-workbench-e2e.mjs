import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { runBrowserTest } from "./browser_test_session.mjs";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const artifacts = resolve(process.env.NGB_AIG_ARTIFACT_DIR || join(root, "dc_runs", `aig-workbench-${Date.now()}`));
await mkdir(artifacts, { recursive: true });
const report = { startedAt: new Date().toISOString(), cases: [], errors: [], externalRequests: [], failedRequests: [] };
const fixtureRoot = join(root, "tests", "fixtures", "aig");
let currentCase = "startup";
const netlist = `module top(input a,b, output y,z); AND2 u_and (.A(a),.B(b),.Y(y)); INV u_inv (.A(a),.Y(z)); endmodule
module peer(input a,b, output y,z); OR2 u_or (.A(a),.B(b),.Y(y)); INV u_inv (.A(b),.Y(z)); endmodule`;
const file = (name, text) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });

async function check(name, run) {
  currentCase = name;
  const start = Date.now();
  report.cases.push({ name, ...(await run()), durationMs: Date.now() - start });
}

async function click(page, selector) {
  const target = page.locator(selector).first();
  for (const menu of await target.locator("xpath=ancestor::details").all()) {
    if (!await menu.evaluate((element) => element.open)) await menu.locator(":scope > summary").click();
  }
  await target.click();
}

async function screenshot(page, name) {
  await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: false });
}

async function waitAig(page, name) {
  await page.waitForFunction((name) => document.querySelector("#statusBar").textContent.includes(`Loaded ${name}`), name, { timeout: 30000 });
  await page.locator("#schematicMount [data-aig-node]").first().waitFor();
  assert.equal(await page.locator("#domainToolbar").isVisible(), true);
}

async function loadAig(page, name, text) {
  const start = Date.now();
  await page.locator("#aigFileInput").setInputFiles(file(name, text));
  await waitAig(page, name);
  return Date.now() - start;
}

async function geometry(page) {
  return page.locator("#schematicMount").evaluate((mount) => [...mount.querySelectorAll("[data-aig-object]")].map((element) => ({
    id: element.dataset.aigObject,
    shapes: [...element.querySelectorAll(".aig-node-shape,.aig-edge-path,.aig-edge-arrow")].map((shape) => ({
      tag: shape.tagName, attributes: ["d", "cx", "cy", "rx", "ry", "x", "y", "width", "height", "points"].map((key) => [key, shape.getAttribute(key)])
    })),
    labels: [...element.querySelectorAll(".aig-node-label")].map((label) => ({ text: label.textContent, x: label.getAttribute("x"), y: label.getAttribute("y") }))
  })));
}

async function jobCount(page) {
  return page.evaluate(() => window.__aigObservations.requests.length);
}

async function storage(page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem("ngb.domain-workspace.v1")));
}

function withoutViewport(snapshot) {
  // Status/shell reflow can legitimately preserve physical zoom by updating the
  // viewport. Import races must preserve the document, selection and policies.
  const { viewport, ...documentState } = snapshot || {};
  return documentState;
}

async function holdFileRead(page, selector, name, text) {
  await page.evaluate((name) => { window.__aigObservations.fileReads[name] = { started: false, finished: false }; }, name);
  await page.locator(selector).setInputFiles(file(name, text));
  await page.waitForFunction((name) => window.__aigObservations.fileReads[name]?.started, name);
}

async function releaseFileRead(page, name) {
  await page.evaluate((name) => window.__aigObservations.fileReads[name].release(), name);
  await page.waitForFunction((name) => window.__aigObservations.fileReads[name]?.finished, name);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function pressEmptySearchEnter(page) {
  assert.equal(await page.locator("#searchInput").inputValue(), "");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "searchInput", "file replacement preserves the existing search focus");
  await page.evaluate(() => {
    window.__aigObservations.searchEnterPrevented = null;
    window.addEventListener("keydown", (event) => {
      window.__aigObservations.searchEnterPrevented = event.defaultPrevented;
    }, { once: true });
  });
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => window.__aigObservations.searchEnterPrevented), false,
    "an empty search cannot activate a result from the previous document");
  assert.equal(await page.locator("#searchResults").isVisible(), false);
  assert.equal(await page.locator("#searchResults [data-search-index]").count(), 0);
}

async function openPage(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  await context.route("**/*", async (route) => {
    const requested = new URL(route.request().url());
    if (["http:", "https:"].includes(requested.protocol) && requested.origin !== new URL(url).origin) {
      report.externalRequests.push(requested.href);
      await route.abort();
    } else await route.continue();
  });
  await context.route("**/parser/verilogParser.js", async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    const signature = "export function parseVerilog(source) {";
    assert.ok(original.includes(signature));
    await route.fulfill({ response, body: original.replace(signature,
      signature + " globalThis.__parseVerilogCalls = (globalThis.__parseVerilogCalls || 0) + 1;") });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => report.errors.push({ case: currentCase, message: error.message }));
  page.on("requestfailed", (request) => report.failedRequests.push({ case: currentCase, url: request.url(), error: request.failure()?.errorText }));
  // Observe real Worker requests without substituting parsing, layout, or results.
  await page.addInitScript(() => {
    window.__aigObservations = { workers: 0, requests: [], fileReads: {} };
    const readFileText = File.prototype.text;
    File.prototype.text = async function (...args) {
      const text = await readFileText.apply(this, args);
      // Preserve the real file bytes while making a slow I/O completion
      // reproducible for replacement/cancel tests.
      if (this.name.startsWith("slow-read")) await new Promise((resolve) => setTimeout(resolve, 350));
      const held = window.__aigObservations.fileReads[this.name];
      if (held) {
        await new Promise((resolve) => { held.release = resolve; held.started = true; });
        held.finished = true;
      }
      return text;
    };
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, { construct(target, args) {
      const worker = Reflect.construct(target, args);
      if (String(args[0]).includes("graphviz_worker.js")) {
        window.__aigObservations.workers += 1;
        const original = worker.postMessage.bind(worker);
        worker.postMessage = (...values) => {
          window.__aigObservations.requests.push({ format: values[0]?.format, startedAt: performance.now() });
          return original(...values);
        };
      }
      return worker;
    } });
  });
  await page.goto(url, { timeout: 45000 });
  await page.locator("#schematicMount svg").waitFor({ timeout: 45000 });
  return { context, page };
}

try {
  const blif = await readFile(join(fixtureRoot, "shared_cone.blif"), "utf8");
  const dot = await readFile(join(fixtureRoot, "shared_cone.dot"), "utf8");
  await runBrowserTest(async ({ browser, url }) => {
    const { context, page } = await openPage(browser, url);
    try {
      let initialGeometry;
      await check("real-import-compare-to-aig-and-format-parity", async () => {
        assert.equal(await jobCount(page), 0, "Netlist startup does not initialize Graphviz");
        assert.equal(await page.locator("#layoutProviderSelect").inputValue(), DEFAULT_LAYOUT_PROVIDER_ID);
        await page.locator("#fileInput").setInputFiles(file("before.v", netlist));
        await page.locator('#schematicMount [data-node-id="cell:u_and"]').waitFor();
        await click(page, "#compareButton");
        await page.locator("#leftSchematicMount svg").waitFor();
        const coldImportMs = await loadAig(page, "named.blif", blif);
        assert.equal(await page.locator("#compareMount").isVisible(), false);
        assert.equal(await page.locator("#compareButton").isVisible(), false);
        assert.equal(await page.locator("#libertyMenu").isVisible(), false);
        assert.equal(await page.locator("#layoutMenu").isVisible(), false);
        assert.equal(await page.locator("#schematicMount [data-aig-node]").count(), 15);
        assert.equal(await page.locator("#schematicMount [data-aig-edge]").count(), 19);
        assert.equal(await page.locator("#schematicMount .aig-edge-path[stroke-dasharray]").count(), 10);
        const labels = await page.locator("#schematicMount [data-aig-node] text").allTextContents();
        for (const label of ["a", "b", "c", "d", "y", "shared", "masked"]) assert.ok(labels.includes(label), label);
        assert.ok(await page.locator("#schematicMount .aig-edge-path").evaluateAll((paths) => paths.some((path) => /C/.test(path.getAttribute("d")))), "real Graphviz cubic curves rendered");
        initialGeometry = await geometry(page);
        const warmImportMs = await loadAig(page, "named.dot", dot);
        assert.deepEqual(await geometry(page), initialGeometry, "two real importers produce identical controlled geometry");
        assert.match(await page.locator("#domainNavigator").innerText(), /ABC AIG DOT/);
        await screenshot(page, "named-dot");
        return { coldImportMs, warmImportMs, nodes: 15, edges: 19, invertedEdges: 10, graphvizCalls: await jobCount(page) };
      });

      await check("panels-search-selection-highlight-export", async () => {
        const before = await jobCount(page);
        await click(page, '[data-aig-nav-tab="objects"]');
        assert.equal(await page.locator("#domainNavigator [data-aig-select]").count(), 7, "default list contains PI/PO");
        const output = page.locator('#domainNavigator [data-aig-select][title="shared"]').first();
        const selectedId = await output.getAttribute("data-aig-select");
        await output.click();
        await page.locator(`#domainInspector [data-aig-inspected-id="${selectedId}"]`).waitFor();
        assert.equal(await page.locator(`#schematicMount [data-aig-object="${selectedId}"] .aig-selection-halo`).getAttribute("visibility"), "visible");
        await page.locator('[data-aig-filter="type"]').selectOption("and");
        assert.equal(await page.locator("#domainNavigator [data-aig-select]").count(), 8);
        assert.equal(await page.locator("[data-aig-show-selection]").count(), 1);
        await page.locator('[data-aig-filter="analysisFilter"]').selectOption("fanout");
        assert.equal(await page.locator("#domainNavigator [data-aig-select]").count(), 2);
        await click(page, "[data-aig-show-selection]");
        await page.locator('[data-aig-filter="query"]').fill("shared");
        await page.waitForFunction(() => [...document.querySelectorAll("#domainNavigator [data-aig-select]")].some((button) => button.title === "shared"));
        assert.equal(await page.locator('[data-aig-filter="query"]').inputValue(), "shared");
        await page.locator('[data-aig-filter="query"]').fill("");
        await page.locator('[data-aig-filter="type"]').selectOption("ports");
        await click(page, '[data-aig-inspector-tab="source"]');
        assert.match(await page.locator("#domainInspector").innerText(), /Source ID/);
        await click(page, '[data-aig-inspector-tab="analysis"]');
        assert.match(await page.locator('[data-aig-inspector-content="analysis"]').innerText(), /AND depth\s+\d+/);
        await click(page, '[data-aig-inspector-tab="connections"]');
        await click(page, "#fitButton");
        await screenshot(page, "objects-connections");
        const edgeButton = page.locator("#domainInspector [data-aig-select]").filter({ hasText: /^Slot / }).first();
        const edgeId = await edgeButton.getAttribute("data-aig-select");
        await edgeButton.click();
        assert.equal(await page.locator("#domainInspector [data-aig-inspected-id]").getAttribute("data-aig-inspected-id"), edgeId);
        assert.equal(await page.locator(`#schematicMount [data-aig-edge="${edgeId}"] .aig-selection-halo`).first().getAttribute("visibility"), "visible");
        await click(page, "#fitButton");
        const edgePoint = await page.locator(`#schematicMount [data-aig-edge="${edgeId}"] .aig-edge-hit`).first().evaluate((path) => {
          const point = path.getPointAtLength(path.getTotalLength() * .5);
          const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
          return { x: screen.x, y: screen.y };
        });
        await page.mouse.click(edgePoint.x, edgePoint.y);
        assert.equal(await page.locator("#domainInspector [data-aig-inspected-id]").getAttribute("data-aig-inspected-id"), edgeId, "real curve hit selects precisely one logical edge");
        assert.deepEqual(await page.locator('.aig-edge .aig-selection-halo[visibility="visible"]').evaluateAll((halos) => [...new Set(halos.map((halo) => halo.closest("[data-aig-edge]").dataset.aigEdge))]), [edgeId]);
        await page.locator("#searchInput").fill("masked");
        await page.locator("#searchResults [data-search-index]").first().waitFor();
        await page.locator("#searchResults [data-search-index]").first().click();
        assert.match(await page.locator("#domainInspector .inspector-object-name").innerText(), /masked/);
        assert.equal(await page.locator("#searchResults").isVisible(), false, "click activation closes the search popup");
        await page.locator("#searchInput").fill("shared");
        await page.locator("#searchResults [data-search-index]").first().waitFor();
        const composition = await page.evaluate(() => {
          const selection = document.querySelector("#domainInspector [data-aig-inspected-id]").dataset.aigInspectedId;
          const event = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true });
          document.querySelector("#searchInput").dispatchEvent(event);
          return { prevented: event.defaultPrevented, selection,
            current: document.querySelector("#domainInspector [data-aig-inspected-id]").dataset.aigInspectedId };
        });
        assert.equal(composition.prevented, false, "IME confirmation keeps its native key behavior");
        assert.equal(composition.current, composition.selection, "IME confirmation cannot activate a search result");
        await page.locator("#searchInput").press("Enter");
        assert.equal(await page.locator("#searchResults").isVisible(), false, "Enter activation closes the search popup");
        await page.locator("#searchInput").press("ArrowDown");
        assert.equal(await page.locator("#searchResults").isVisible(), true, "arrow navigation can reopen the current results");
        await page.locator("#searchInput").press("Escape");
        await page.locator("#settingsMenu > summary").click();
        await page.locator('[data-domain-policy="critical"]').uncheck();
        await page.locator('[data-domain-policy="fanout"]').uncheck();
        assert.equal(await page.locator('#schematicMount .aig-edge-path[stroke="#dc2626"]').count(), 0);
        await page.locator('[data-domain-policy="fanoutThreshold"]').fill("3");
        await page.locator('[data-domain-policy="fanoutThreshold"]').press("Tab");
        assert.deepEqual(await geometry(page), initialGeometry, "highlight and selection preserve geometry");
        await page.locator('[data-domain-policy="critical"]').check();
        await page.locator('[data-domain-policy="fanout"]').check();
        assert.equal(await page.locator('#schematicMount .aig-edge-path[stroke="#dc2626"]').count(), 9);
        assert.equal(await jobCount(page), before, "panels/search/highlight never invoke layout");
        const downloaded = page.waitForEvent("download");
        await click(page, "#exportSvgButton");
        const download = await downloaded;
        const svg = await readFile(await download.path(), "utf8");
        const exported = await page.evaluate((markup) => {
          const document = new DOMParser().parseFromString(markup, "image/svg+xml");
          return { transform: document.querySelector("#schematicContent").getAttribute("transform"),
            nodes: document.querySelectorAll("[data-aig-node]").length, edges: document.querySelectorAll("[data-aig-edge]").length };
        }, svg);
        assert.equal(exported.transform, null, "SVG export contains the full graph, independent of the interactive viewport");
        assert.equal(exported.nodes, 15);
        assert.equal(exported.edges, 19);
        assert.match(svg, /stroke-dasharray="5 4"/);
        assert.match(svg, /stroke="#dc2626"/);
        assert.match(svg, /masked/);
        assert.doesNotMatch(svg, /<script|(?:href|src)="https?:\/\//i);
        await writeFile(join(artifacts, "named-export.svg"), svg);
        await screenshot(page, "selected-analysis");
        return { selectedId, edgeId, graphvizCalls: before };
      });

      await check("copy-source-text-handles-unavailable-clipboard", async () => {
        await click(page, '[data-aig-inspector-tab="source"]');
        const copy = page.locator("#domainInspector [data-aig-copy]").last();
        const expected = await copy.getAttribute("data-aig-copy");
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await copy.click();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected, "copy preserves literal source text");
        try {
          await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
          await copy.click();
          await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Copy unavailable"));
          await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true,
            value: { writeText() { throw new Error("clipboard blocked"); } } }));
          await copy.click();
          await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Copy unavailable"));
        } finally {
          await page.evaluate(() => { delete navigator.clipboard; });
        }
        return { copiedSourceText: true, unavailableClipboardHandled: true };
      });

      await check("viewport-panel-resize-persistence-and-failure-atomicity", async () => {
        const before = await jobCount(page);
        const canvas = await page.locator("#canvas").boundingBox();
        await page.mouse.move(canvas.x + canvas.width * .5, canvas.y + canvas.height * .5);
        await page.mouse.wheel(0, -250);
        await page.waitForTimeout(350);
        const saved = await storage(page);
        assert.ok(saved.viewport.scale !== 1);
        await click(page, "#toggleNavigatorButton");
        await click(page, "#toggleNavigatorButton");
        assert.ok(Math.abs((await storage(page)).viewport.scale - saved.viewport.scale) < 1e-12,
          "panel resize compensation preserves scale to floating-point precision");
        const handle = page.locator("#navigatorResizeHandle");
        await handle.focus();
        await page.keyboard.press("ArrowRight");
        assert.equal(await jobCount(page), before);
        const beforeReload = await storage(page);
        await page.reload();
        await waitAig(page, "named.dot");
        const restored = await storage(page);
        assert.deepEqual(restored.viewport, beforeReload.viewport);
        assert.equal(restored.selectedId, saved.selectedId);
        assert.equal(restored.presentationPolicy.fanoutThreshold, 3);
        assert.deepEqual(await geometry(page), initialGeometry);
        await page.locator("#aigFileInput").setInputFiles(file("bad.blif", ".model bad\n.inputs a\n.outputs y\n.latch a y\n.end"));
        await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("bad.blif") && document.querySelector("#cancelDomainImportButton").hidden);
        assert.deepEqual(await geometry(page), initialGeometry, "invalid candidate preserves last usable document");
        assert.equal((await storage(page)).source.name, "named.dot");
        return { viewport: restored.viewport, selectedId: restored.selectedId };
      });

      await check("slow-file-replacement-cancel-and-cross-document-pan", async () => {
        const before = await jobCount(page);
        await page.locator("#aigFileInput").setInputFiles(file("slow-read-replaced.blif", blif));
        await loadAig(page, "newer.dot", dot);
        await page.waitForTimeout(400);
        assert.equal((await storage(page)).source.name, "newer.dot", "late file.text completion cannot replace the newer document");
        assert.equal(await jobCount(page), before + 1, "superseded file read never starts layout");
        await page.locator("#aigFileInput").setInputFiles(file("slow-read-cancelled.blif", blif));
        await click(page, "#cancelDomainImportButton");
        await page.waitForTimeout(400);
        assert.equal((await storage(page)).source.name, "newer.dot");
        assert.equal(await jobCount(page), before + 1, "cancelled file read never starts layout");
        assert.match(await page.locator("#statusBar").innerText(), /Import cancelled/);
        const box = await page.locator("#canvas").boundingBox();
        await page.mouse.move(box.x + 12, box.y + 12);
        await page.mouse.down();
        await page.mouse.move(box.x + 45, box.y + 35);
        await loadAig(page, "named.dot", dot);
        const committed = (await storage(page)).viewport;
        await page.mouse.move(box.x + 160, box.y + 90);
        await page.mouse.up();
        assert.deepEqual((await storage(page)).viewport, committed, "old pointer gesture cannot commit into the new document");
        assert.deepEqual(await geometry(page), initialGeometry);
        return { replacedReads: 1, cancelledReads: 1, oldGestureIgnored: true };
      });

      await check("cross-domain-file-selection-cancels-older-reads", async () => {
        await holdFileRead(page, "#fileInput", "held-older-netlist.v", netlist);
        await loadAig(page, "newer-than-netlist.blif", blif);
        const committed = await storage(page);
        const committedGeometry = await geometry(page);
        await releaseFileRead(page, "held-older-netlist.v");
        assert.deepEqual(withoutViewport(await storage(page)), withoutViewport(committed), "a late Netlist read cannot replace the newer AIG document");
        assert.deepEqual(await geometry(page), committedGeometry);
        assert.equal(await page.locator("#domainToolbar").isVisible(), true);

        await holdFileRead(page, "#aigFileInput", "held-older-aig.blif", blif);
        await holdFileRead(page, "#fileInput", "held-newer-netlist.v", netlist);
        const before = await jobCount(page);
        await releaseFileRead(page, "held-older-aig.blif");
        assert.equal(await jobCount(page), before, "a newer Netlist selection cancels an old AIG read before the Netlist read completes");
        assert.deepEqual(withoutViewport(await storage(page)), withoutViewport(committed), "the prior usable AIG remains while the replacement Netlist is reading");
        assert.deepEqual(await geometry(page), committedGeometry);
        await releaseFileRead(page, "held-newer-netlist.v");
        await page.locator('#schematicMount [data-node-id="cell:u_and"]').waitFor();
        assert.equal(await storage(page), null);
        assert.equal(await page.locator("#domainToolbar").isVisible(), false);
        await loadAig(page, "named.dot", dot);
        return { lateNetlistIgnored: true, lateAigIgnoredBeforeNetlistRead: true };
      });

      await check("document-switch-clears-search-controller-state", async () => {
        await page.locator("#searchInput").fill("masked");
        await page.locator("#searchResults [data-search-index]").first().waitFor();
        await loadAig(page, "renamed.blif", blif.replaceAll("masked", "renamed"));
        const replaced = await storage(page);
        await pressEmptySearchEnter(page);
        assert.deepEqual(await storage(page), replaced, "empty Enter preserves the replacement AIG selection and viewport");

        await page.locator("#searchInput").fill("renamed");
        await page.locator("#searchResults [data-search-index]").first().waitFor();
        await page.locator("#fileInput").setInputFiles(file("search-netlist.v", netlist));
        await page.locator('#schematicMount [data-node-id="cell:u_and"]').waitFor();
        const netlistSelection = await page.locator("#selectionSummaryButton").innerText();
        await pressEmptySearchEnter(page);
        assert.equal(await page.locator("#selectionSummaryButton").innerText(), netlistSelection);
        assert.equal(await storage(page), null);

        await page.locator("#searchInput").fill("u_and");
        await page.locator("#searchResults [data-search-index]").first().waitFor();
        await loadAig(page, "named.dot", dot);
        const returned = await storage(page);
        await pressEmptySearchEnter(page);
        assert.deepEqual(await storage(page), returned, "a previous Netlist result cannot activate in AIG");
        return { aigReplacement: true, aigToNetlist: true, netlistToAig: true };
      });

      await check("aig-focus-shortcut-preserves-browser-modifiers", async () => {
        await click(page, '[data-aig-nav-tab="objects"]');
        await click(page, '#domainNavigator [data-aig-select][title="shared"]');
        await click(page, "#fitButton");
        const fitted = (await storage(page)).viewport;
        const modifiers = await page.evaluate(() => [
          { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }
        ].map((options) => {
          const event = new KeyboardEvent("keydown", { key: "f", ...options, bubbles: true, cancelable: true });
          document.body.dispatchEvent(event);
          return { ...options, defaultPrevented: event.defaultPrevented };
        }));
        for (const shortcut of modifiers) assert.equal(shortcut.defaultPrevented, false, JSON.stringify(shortcut));
        assert.deepEqual((await storage(page)).viewport, fitted, "modified and composition keys cannot focus the canvas");
        const plainPrevented = await page.evaluate(() => {
          const event = new KeyboardEvent("keydown", { key: "f", bubbles: true, cancelable: true });
          document.body.dispatchEvent(event);
          return event.defaultPrevented;
        });
        assert.equal(plainPrevented, true, "plain F still handles the selected object");
        assert.notDeepEqual((await storage(page)).viewport, fitted, "plain F focuses the selected AIG object");
        await click(page, "#fitButton");
        await click(page, "#helpButton");
        await page.locator("#helpDialog").waitFor({ state: "visible" });
        await page.keyboard.press("f");
        assert.deepEqual((await storage(page)).viewport, fitted, "a modal owns its keys without moving the canvas behind it");
        await page.keyboard.press("Escape");
        await page.locator("#helpDialog").waitFor({ state: "hidden" });
        return { modifiersPreserved: modifiers.length, plainFocusHandled: true, modalIsolated: true };
      });

      await check("explicit-viewport-actions-supersede-pending-gestures", async () => {
        const before = await jobCount(page);
        for (const action of ["fit", "focus"]) {
          const result = await page.evaluate(async (action) => {
            const canvas = document.querySelector("#canvas");
            const content = document.querySelector("#schematicContent");
            const box = canvas.getBoundingClientRect();
            canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, clientX: box.x + box.width / 2,
              clientY: box.y + box.height / 2, bubbles: true, cancelable: true }));
            if (action === "fit") document.querySelector("#fitButton").click();
            else document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true, cancelable: true }));
            const expected = content.getAttribute("transform");
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return { expected, actual: content.getAttribute("transform") };
          }, action);
          assert.equal(result.actual, result.expected, `${action} cannot be overwritten by an earlier wheel frame`);
        }
        const box = await page.locator("#canvas").boundingBox();
        await page.mouse.move(box.x + 10, box.y + 10);
        await page.mouse.down();
        await page.mouse.move(box.x + 40, box.y + 30);
        await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true, cancelable: true })));
        const focused = (await storage(page)).viewport;
        await page.mouse.move(box.x + 100, box.y + 70);
        await page.mouse.up();
        assert.deepEqual((await storage(page)).viewport, focused, "late pan frames cannot replace explicit focus");
        assert.equal(await jobCount(page), before);
        return { pendingWheelSuperseded: true, pendingPanSuperseded: true };
      });

      await check("show-selection-reveals-objects-on-later-pages", async () => {
        const inputs = Array.from({ length: 150 }, (_, index) => `pin${String(index).padStart(3, "0")}`);
        await loadAig(page, "paginated.blif", `.model paginated\n.inputs ${inputs.join(" ")}\n.outputs y\n.names pin149 y\n1 1\n.end\n`);
        await click(page, '[data-aig-nav-tab="objects"]');
        await page.locator("#searchInput").fill("pin149");
        await click(page, "#searchResults [data-search-index]");
        const selected = (await storage(page)).selectedId;
        await page.locator('[data-aig-filter="query"]').fill("pin000");
        await click(page, `[data-aig-show-selection="${selected}"]`);
        assert.equal(await page.locator(`#domainNavigator [data-aig-select="${selected}"][aria-current="true"]`).count(), 1,
          "Show selection must jump to the selected object's page after clearing an excluding filter");
        assert.equal(await page.locator('[data-aig-filter="query"]').inputValue(), "");

        await page.locator('[data-aig-filter="type"]').selectOption("pi");
        await page.locator('[data-aig-filter="query"]').fill("pin");
        await click(page, `[data-aig-show-selection="${selected}"]`);
        assert.equal(await page.locator('[data-aig-filter="type"]').inputValue(), "pi");
        assert.equal(await page.locator('[data-aig-filter="query"]').inputValue(), "pin");
        assert.equal(await page.locator(`#domainNavigator [data-aig-select="${selected}"][aria-current="true"]`).count(), 1,
          "A selection on another page retains the matching filter");
        await click(page, '#domainNavigator [data-aig-page="0"]');
        assert.equal(await page.locator(`#domainNavigator [data-aig-select="${selected}"]`).count(), 0,
          "manual paging is not overridden by the current selection");
        assert.equal(await page.locator(`[data-aig-show-selection="${selected}"]`).count(), 1);
        await loadAig(page, "named.dot", dot);
        return { excludedFilterRevealed: true, matchingFilterRetained: true, manualPagingPreserved: true };
      });

      await check("compact-shell-and-return-to-netlist", async () => {
        await page.setViewportSize({ width: 1100, height: 768 });
        if (await page.locator("#closeProcessLogButton").isVisible()) await click(page, "#closeProcessLogButton");
        await click(page, "#toggleNavigatorButton");
        assert.equal(await page.locator("#domainNavigator").isVisible(), true);
        await click(page, '[data-aig-nav-tab="objects"]');
        await click(page, '#domainNavigator [data-aig-select][title="shared"]');
        await page.keyboard.press("Escape");
        await click(page, "#fitButton");
        await click(page, "#toggleInspectorButton");
        assert.equal(await page.locator("#domainInspector").isVisible(), true);
        await screenshot(page, "compact-inspector");
        await page.keyboard.press("Escape");
        const saved = await storage(page);
        await page.locator("#fileInput").setInputFiles(file("invalid.v", "module ; endmodule"));
        await page.waitForFunction(() => document.querySelector("#processLogList").textContent.includes("Design parse failed"));
        assert.deepEqual(await storage(page), saved);
        assert.equal(await page.locator("#domainToolbar").isVisible(), true);
        const parseCount = await page.evaluate(() => globalThis.__parseVerilogCalls);
        await page.locator("#fileInput").setInputFiles(file("after.v", netlist));
        await page.locator('#schematicMount [data-node-id="cell:u_and"]').waitFor();
        assert.equal(await page.evaluate(() => globalThis.__parseVerilogCalls), parseCount + 1);
        assert.equal(await page.locator("#domainToolbar").isVisible(), false);
        assert.equal(await page.locator("#compareButton").isVisible(), true);
        await page.locator("#settingsMenu > summary").click();
        assert.equal(await page.locator("#libertyMenu").isVisible(), true);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#layoutProviderSelect").inputValue(), DEFAULT_LAYOUT_PROVIDER_ID);
        assert.equal(await storage(page), null);
        await page.reload();
        await page.locator('#schematicMount [data-node-id="cell:u_and"]').waitFor();
        assert.equal(await page.locator("#domainToolbar").isVisible(), false);
        return { netlistSessionRestored: true };
      });
      assert.deepEqual(report.errors, []);
      assert.deepEqual(report.externalRequests, [], "real runtime operates offline");
      assert.deepEqual(report.failedRequests, []);
    } catch (error) {
      await screenshot(page, "failure").catch(() => {});
      report.visibleText = await page.locator("body").innerText().catch(() => "");
      throw error;
    } finally { await context.close(); }
    await check("denied-session-storage-startup-and-import", async () => {
      const deniedContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      const deniedPage = await deniedContext.newPage();
      deniedPage.on("pageerror", (error) => report.errors.push({ case: currentCase, message: error.message }));
      await deniedPage.addInitScript(() => Object.defineProperty(window, "sessionStorage", {
        get() { throw new DOMException("Storage access denied for test", "SecurityError"); }
      }));
      try {
        await deniedPage.goto(url);
        await deniedPage.locator("#schematicMount svg").waitFor({ timeout: 30000 });
        await loadAig(deniedPage, "storage-denied.blif", blif);
        assert.equal(await deniedPage.locator("#schematicMount [data-aig-node]").count(), 15);
        assert.deepEqual(report.errors, []);
        return { storageOptional: true };
      } finally { await deniedContext.close(); }
    });
  }, { root, chromium, executablePath: process.env.NGB_CHROME,
    ...(process.env.NGB_NATIVE_EXECUTABLE ? { createServer: () => spawn(process.env.NGB_NATIVE_EXECUTABLE,
      ["start", "--no-open", "--port", "0"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }) } : {}) });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = { case: currentCase, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(artifacts, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, failure: report.failure, artifacts }));
}
