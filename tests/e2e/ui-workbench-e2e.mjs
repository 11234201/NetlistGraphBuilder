import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const artifactDirectory = resolve(process.env.NGB_UI_ARTIFACT_DIR || join(root, "dc_runs", `ui-workbench-${Date.now()}`));
const casePattern = process.env.NGB_UI_CASE_PATTERN ? new RegExp(process.env.NGB_UI_CASE_PATTERN) : null;
await mkdir(artifactDirectory, { recursive: true });
const report = { startedAt: new Date().toISOString(), provider: DEFAULT_LAYOUT_PROVIDER_ID, cases: [], screenshots: [], errors: [], requestFailures: [], externalRequests: [] };
let currentPage;
let currentCase = "startup";

const workflowSource = `module top(input a, b, output y, z);
  wire n;
  BUF u_first (.A(a), .Y(n));
  AND2 u_second (.A(n), .B(b), .Y(y));
  INV u_other (.A(a), .Y(z));
endmodule
module peer(input a, b, output y, z);
  wire n;
  BUF u_first (.A(a), .Y(n));
  OR2 u_second (.A(n), .B(b), .Y(y));
  INV u_other (.A(a), .Y(z));
endmodule`;

const file = (name, source) => ({ name, mimeType: "text/plain", buffer: Buffer.from(source) });
const node = (page, name, mount = "#schematicMount") => page.locator(`${mount} [data-node-id="cell:${name}"] .node-shape`).first();
const roots = (page) => page.locator("#focusedRootCount");

async function checkCase(name, action) {
  if (casePattern && !casePattern.test(name)) return;
  currentCase = name;
  const startedAt = Date.now();
  const details = await action();
  report.cases.push({ name, durationMs: Date.now() - startedAt, ...details });
}

async function screenshot(page, name) {
  const path = join(artifactDirectory, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  report.screenshots.push(path);
}

async function captureFailure(page, error) {
  report.failure = { ...report.failure, case: currentCase, message: error.message, stack: error.stack };
  if (page.isClosed()) return;
  try { await screenshot(page, "failure"); } catch {}
  try { report.failure.visibleText = await page.locator("body").innerText(); } catch {}
  try { report.failure.activeElement = await page.evaluate(() => document.activeElement.outerHTML.slice(0, 500)); } catch {}
  try { report.failure.fileEvents = await page.evaluate(() => window.__ngbUiObservations?.fileEvents.slice(-30)); } catch {}
}

async function openPage(browser, url, viewport = { width: 1366, height: 768 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await context.newPage();
  currentPage = page;
  page.setDefaultTimeout(10000);
  // Keep headless file-chooser interception enabled before the keyboard action.
  // A per-action listener alone can race immediate keydown activation, causing
  // Chrome's unhandled native picker to emit cancel before interception is ready.
  page.on("filechooser", () => {});
  page.on("pageerror", (error) => report.errors.push({ case: currentCase, message: error.message }));
  page.on("requestfailed", (request) => report.requestFailures.push({ case: currentCase, url: request.url(), failure: request.failure()?.errorText }));
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (["http:", "https:"].includes(requestUrl.protocol) && requestUrl.origin !== new URL(url).origin) {
      report.externalRequests.push({ case: currentCase, url: request.url() });
    }
  });
  // Observation only: no application state or DOM is changed by this collector.
  await page.addInitScript(() => {
    const observations = { interactions: [], longTasks: [], fileEvents: [] };
    window.__ngbUiObservations = observations;
    for (const type of ["keydown", "keyup", "click", "change", "cancel", "toggle"]) document.addEventListener(type, (event) => {
      if (!event.target.closest?.("#fileMenu")) return;
      observations.fileEvents.push({ type, target: event.target.id || event.target.tagName, key: event.key, open: document.querySelector("#fileMenu").open, time: performance.now() });
    }, true);
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver((list) => observations.longTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })))).observe({ type: "longtask", buffered: true });
    }
    document.addEventListener("click", (event) => {
      const target = event.target.closest("#toggleInspectorButton, [data-inspector-tab], [data-search-index]");
      if (!target) return;
      const kind = target.id === "toggleInspectorButton" ? "panel" : target.hasAttribute("data-inspector-tab") ? "tab" : "selection";
      const startTime = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => observations.interactions.push({ kind, startTime, duration: performance.now() - startTime })));
    }, true);
  });
  await page.goto(url, { timeout: 45000 });
  await page.locator("#schematicMount svg").waitFor({ timeout: 45000 });
  await page.waitForFunction(() => !/^(Layout|Rendering)/.test(document.querySelector("#statusBar").textContent));
  assert.equal(await page.locator("#layoutProviderSelect").inputValue(), DEFAULT_LAYOUT_PROVIDER_ID, "UI acceptance uses the product default provider");
  return { context, page };
}

// Only open ancestor disclosures through their visible summaries. This helper
// deliberately does not force clicks or call DOM click()/dispatchEvent().
async function revealDisclosure(locator) {
  const isSummary = await locator.evaluate((element) => element.tagName === "SUMMARY");
  const ancestors = await locator.locator(isSummary ? "xpath=parent::details/ancestor::details" : "xpath=ancestor::details").all();
  for (const disclosure of ancestors) {
    if (!await disclosure.evaluate((element) => element.open)) {
      await disclosure.locator(":scope > summary").click();
      await locator.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
  }
}

async function click(page, selector) {
  const locator = page.locator(selector);
  await revealDisclosure(locator);
  await locator.click();
}

async function upload(page, inputId, value) {
  const input = page.locator(`#${inputId}`);
  await revealDisclosure(input);
  const chooser = page.waitForEvent("filechooser");
  await input.locator("xpath=ancestor::label[1]").click();
  await (await chooser).setFiles(value);
  await page.keyboard.press("Escape");
}

async function importDesign(page, source, name = "ui-workflow.v", expectedNode = "u_first") {
  await upload(page, "fileInput", file(name, source));
  if (expectedNode) await node(page, expectedNode).waitFor({ timeout: 45000 });
  await page.waitForFunction((name) => document.querySelector("#statusBar").textContent.includes(`Loaded ${name}`), name);
}

async function search(page, name, { add = false, kind = "instance", moduleName = null } = {}) {
  await page.locator("#searchInput").fill(name);
  let row = page.locator(".search-result").filter({
    has: page.locator(".search-result-label", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })
  }).filter({ has: page.locator(".search-result-kind", { hasText: new RegExp(`^${kind}$`, "i") }) });
  if (moduleName) row = row.filter({ has: page.locator(".search-result-context", { hasText: new RegExp(` / ${moduleName}$`) }) });
  assert.equal(await row.count(), 1, `Unique ${kind} result for ${name}`);
  await row.locator(add ? "[data-search-add-index]" : "[data-search-index]").click();
  await page.locator("#searchResults").waitFor({ state: "hidden" });
}

async function waitRootCount(page, count) {
  await page.waitForFunction((count) => document.querySelector("#focusedRootCount").textContent.trim() === String(count), count);
}

async function expectInsideViewport(page, locator, label) {
  await locator.waitFor({ state: "visible" });
  await locator.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await locator.isVisible(), true, `${label} is visible`);
  const bounds = await locator.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds && bounds.width > 0 && bounds.height > 0, `${label} has a rendered box`);
  assert.ok(bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= viewport.width + 1 &&
    bounds.y + bounds.height <= viewport.height + 1, `${label} is inside viewport: ${JSON.stringify({ bounds, viewport })}`);
  return bounds;
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => [document.documentElement, document.body,
    document.querySelector("#inspectorPanel"), document.querySelector("#navigatorPanel")]
    .filter((element) => element && element.getBoundingClientRect().width > 0)
    .map((element) => ({ name: element.id || element.tagName, client: element.clientWidth, scroll: element.scrollWidth }))
    .filter((entry) => entry.scroll > entry.client + 2));
  if (overflow.length) {
    const protrudingControls = await page.evaluate(() => [...document.querySelectorAll("body *")]
      .filter((element) => !element.closest("svg, details:not([open])") && element.checkVisibility())
      .map((element) => ({ id: element.id, className: element.className, bounds: element.getBoundingClientRect().toJSON() }))
      .filter((entry) => entry.bounds.width > 0 && entry.bounds.right > innerWidth + 1));
    const textOverflow = await page.evaluate(() => [...document.querySelectorAll("body *")]
      .filter((element) => !element.closest("svg, details:not([open])") && element.checkVisibility() && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
      .map((element) => ({ id: element.id, className: element.className, client: element.clientWidth, scroll: element.scrollWidth, overflowX: getComputedStyle(element).overflowX, text: element.textContent.slice(0, 80) })));
    report.failure = { ...report.failure, protrudingControls, textOverflow };
  }
  assert.deepEqual(overflow, [], "Only data tables may scroll horizontally, never the page or full side panel");
}

async function geometrySignature(page) {
  return page.locator("#schematicMount").evaluate((mount) => ({
    nodes: [...mount.querySelectorAll(".node")].map((element) => [element.dataset.nodeId, element.getAttribute("transform")]),
    paths: [...mount.querySelectorAll(".wire")].map((element) => element.getAttribute("d"))
  }));
}

async function expectFullWidthCanvas(page) {
  for (const name of ["Navigator", "Inspector"]) {
    assert.equal(await page.locator(`#${name.toLowerCase()}Panel`).isVisible(), false);
    const toggle = page.locator(`#toggle${name}Button`);
    await expectInsideViewport(page, toggle, `Show ${name} toggle`);
    assert.equal(await toggle.getAttribute("aria-label"), `Show ${name}`);
  }
  const workspace = await page.locator(".workspace").boundingBox();
  const canvas = await page.locator("#canvas").boundingBox();
  assert.ok(Math.abs(canvas.width - workspace.width) <= 2, "Hiding both panels releases the entire workspace width to the canvas");
  return canvas;
}

async function readingPosition(page) {
  return page.locator("#schematicMount svg").evaluate((svg) => {
    const bounds = svg.getBoundingClientRect();
    const matrix = svg.querySelector("#schematicContent").getScreenCTM();
    const center = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(matrix.inverse());
    const svgMatrix = svg.getScreenCTM();
    return { x: center.x, y: center.y, scale: Math.hypot(matrix.a, matrix.b), svgFit: Math.hypot(svgMatrix.a, svgMatrix.b) };
  });
}

async function expectReadingPosition(page, expected, action) {
  const actual = await readingPosition(page);
  for (const key of ["x", "y"]) {
    const pixelDrift = Math.abs(actual[key] - expected[key]) * expected.scale;
    assert.ok(pixelDrift <= 0.5, `${action} preserves reading ${key} within CSS pixel rounding: ${pixelDrift}px`);
  }
  // formatViewportTransform serializes scale to three decimals. Account for
  // that existing display quantization at both fit ratios, without allowing Fit.
  const scaleRounding = 0.0005 * (actual.svgFit + expected.svgFit) + 1e-6;
  assert.ok(Math.abs(actual.scale - expected.scale) <= scaleRounding, `${action} preserves reading scale within SVG serialization rounding: ${actual.scale} vs ${expected.scale}`);
}

async function layoutCount(page) {
  const toggle = page.locator("#toggleProcessLogButton");
  const wasOpen = await toggle.getAttribute("aria-expanded") === "true";
  if (!wasOpen) await toggle.click();
  const text = await page.locator("#processLogList").textContent();
  const count = (text.match(/Layout completed:/g) || []).length;
  if (!wasOpen) await toggle.click();
  return count;
}

async function expectCompareCanvasGeometry(page, orientation, { checkNodes = false } = {}) {
  // Include the settled ResizeObserver viewport commit, not just the immediate
  // frame after Fit/orientation, so a delayed compensation cannot hide a jump.
  await page.waitForTimeout(200);
  const measurements = [];
  for (const side of ["left", "right"]) {
    const panel = page.locator(`[data-compare-side="${side}"]`);
    const panelBox = await panel.boundingBox();
    const headerBox = await panel.locator(":scope > header").boundingBox();
    const svg = panel.locator("svg");
    const svgBox = await expectInsideViewport(page, svg, `${side} Compare SVG`);
    assert.ok(Math.abs(svgBox.height - (panelBox.height - headerBox.height)) <= 2,
      `${side} SVG uses the panel below its header: ${JSON.stringify({ panelBox, headerBox, svgBox })}`);
    assert.ok(svgBox.height > (orientation === "horizontal" ? 400 : 200), `${side} ${orientation} SVG has usable height: ${svgBox.height}`);
    assert.ok(svgBox.y >= headerBox.y + headerBox.height - 1, `${side} SVG starts below its header`);
    if (checkNodes) {
      const boxes = await panel.locator(".node").evaluateAll((nodes) => nodes.map((element) => ({ id: element.dataset.nodeId, ...element.getBoundingClientRect().toJSON() })));
      assert.ok(boxes.length > 0, `${side} has actual drawn nodes`);
      for (const box of boxes) assert.ok(box.x >= svgBox.x - 2 && box.y >= svgBox.y - 2 &&
        box.right <= svgBox.x + svgBox.width + 2 && box.bottom <= svgBox.y + svgBox.height + 2,
      `${side} Fit keeps the complete ${box.id} node inside its SVG: ${JSON.stringify({ box, svgBox })}`);
    }
    measurements.push({ side, panel: panelBox, header: headerBox, svg: svgBox });
  }
  return measurements;
}

async function layoutCases(browser, url) {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await checkCase(`layout-${viewport.width}`, async () => {
      const { context, page } = await openPage(browser, url, viewport);
      try {
        const canvas = await expectInsideViewport(page, page.locator("#canvas"), "schematic canvas");
        if (viewport.width === 1366) {
          assert.ok(canvas.width >= 1000, `1366px default canvas width: ${canvas.width}`);
          assert.ok(canvas.height >= 640, `1366px default canvas height: ${canvas.height}`);
        }
        const topbar = await page.locator(".topbar").boundingBox();
        assert.ok(topbar.height <= 56, `Topbar stays one row at ${viewport.width}: ${topbar.height}`);
        await expectNoHorizontalOverflow(page);
        await screenshot(page, `single-${viewport.width}`);

        for (const id of ["fileInput", "layoutProviderSelect", "timingMetricSelect", "gateSymbolModeSelect", "libertyInput", "cellConfigInput"]) {
          const target = page.locator(`#${id}`);
          await revealDisclosure(target);
          const popup = target.locator("xpath=ancestor::*[contains(concat(' ',normalize-space(@class),' '),' toolbar-menu-popover ')][1]");
          await expectInsideViewport(page, popup, `${id} popup`);
          await page.keyboard.press("Escape");
          assert.equal(await popup.isVisible(), false, `Escape closes ${id} popup`);
        }

        await search(page, "l_resyn3_u_gen_1395");
        await expectInsideViewport(page, page.locator("[data-inspector-summary]"), "selected object summary");
        await expectInsideViewport(page, page.locator('[data-inspector-tab="connections"]'), "Connections tab");
        assert.match(await page.locator("[data-selection-label]").textContent(), /l_resyn3_u_gen_1395/);
        await click(page, '[data-inspector-tab="timing"]');
        await page.locator(".timing-table-wrap").waitFor();
        const timingOverflow = await page.locator(".timing-table-wrap").evaluate((element) => ({
          overflowX: getComputedStyle(element).overflowX, client: element.clientWidth, scroll: element.scrollWidth
        }));
        assert.ok(["auto", "scroll"].includes(timingOverflow.overflowX), "Timing table owns its horizontal scrolling");
        await expectNoHorizontalOverflow(page);
        await screenshot(page, `timing-${viewport.width}`);

        const geometry = await geometrySignature(page);
        const layoutsBefore = await layoutCount(page);
        await click(page, "#toggleInspectorButton");
        await page.locator("#inspectorPanel").waitFor({ state: "hidden" });
        await search(page, "l_resyn3_u_gen_1390");
        assert.equal(await page.locator("#inspectorPanel").isVisible(), false, "Selection does not reopen a user-closed Inspector");
        await click(page, "#selectionSummaryButton");
        await expectInsideViewport(page, page.locator("[data-inspector-summary]"), "reopened selection summary");
        assert.match(await page.locator("[data-selection-label]").textContent(), /l_resyn3_u_gen_1390/);
        const reading = await readingPosition(page);
        const lowDetailBefore = await page.locator("#canvas").evaluate((element) => element.classList.contains("is-low-detail"));
        await click(page, "#toggleNavigatorButton");
        await expectReadingPosition(page, reading, "Navigator toggle");
        await click(page, "#toggleNavigatorButton");
        await expectReadingPosition(page, reading, "Navigator restored");
        const handle = await page.locator("#inspectorResizeHandle").boundingBox();
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down();
        await page.mouse.move(handle.x + handle.width / 2 - 32, handle.y + handle.height / 2, { steps: 4 });
        await page.mouse.up();
        await expectReadingPosition(page, reading, "Inspector pointer resize");
        const widerHandle = await page.locator("#inspectorResizeHandle").boundingBox();
        await page.mouse.move(widerHandle.x + widerHandle.width / 2, widerHandle.y + widerHandle.height / 2);
        await page.mouse.down();
        await page.mouse.move(widerHandle.x + widerHandle.width / 2 + 32, widerHandle.y + widerHandle.height / 2, { steps: 4 });
        await page.mouse.up();
        await expectReadingPosition(page, reading, "Inspector restored");
        assert.equal(await page.locator("#canvas").evaluate((element) => element.classList.contains("is-low-detail")), lowDetailBefore, "Shell resizing preserves physical detail level");
        assert.deepEqual(await geometrySignature(page), geometry, "Shell changes preserve node and route geometry");
        assert.equal(await layoutCount(page), layoutsBefore, "Panel toggles and selection do not recompute layout");
        await expectNoHorizontalOverflow(page);

        if (!await page.locator("#navigatorPanel").isVisible()) await click(page, "#toggleNavigatorButton");
        await click(page, '[data-close-panel="navigator"]');
        await click(page, '[data-close-panel="inspector"]');
        const fullCanvas = await expectFullWidthCanvas(page);
        await expectReadingPosition(page, reading, "Both panel headers hide their panels");
        await screenshot(page, `full-canvas-${viewport.width}`);
        await click(page, "#toggleNavigatorButton");
        assert.equal(await page.locator("#navigatorPanel").isVisible(), true);
        assert.equal(await page.locator("#inspectorPanel").isVisible(), false, "Restoring Navigator leaves Inspector hidden");
        await click(page, '[data-close-panel="navigator"]');
        await click(page, "#toggleInspectorButton");
        assert.equal(await page.locator("#navigatorPanel").isVisible(), false, "Restoring Inspector leaves Navigator hidden");
        await expectReadingPosition(page, reading, "Independent panel restoration");
        assert.deepEqual(await geometrySignature(page), geometry, "Hiding both panels preserves graph geometry");
        assert.equal(await layoutCount(page), layoutsBefore, "Hiding and restoring both panels does not recompute layout");

        if (!await page.locator("#navigatorPanel").isVisible()) await click(page, "#toggleNavigatorButton");
        await click(page, '[data-nav-tab="hierarchy"]');
        await page.keyboard.press("ArrowRight");
        assert.equal(await page.locator('[data-nav-tab="design"]').getAttribute("aria-selected"), "true");
        await expectInsideViewport(page, page.locator("#designStats"), "design summary");
        await page.keyboard.press("ArrowLeft");
        await expectInsideViewport(page, page.locator("#moduleHierarchyFilter"), "hierarchy search");
        await page.locator("#moduleHierarchyFilter").fill("no_matching_ui_module");
        await page.getByText("No matching module or instance", { exact: true }).waitFor();
        await page.locator("#moduleHierarchyFilter").fill("");
        await click(page, "#toggleNavigatorButton");

        for (let attempt = 0; attempt < 5; attempt++) {
          await click(page, "#fileMenu > summary");
          await page.keyboard.press("Escape");
          await page.keyboard.press("Enter");
          assert.equal(await page.locator("#fileMenu").evaluate((element) => element.open), true, "Enter reopens the focused File disclosure");
          await page.keyboard.press("Tab");
          assert.equal(await page.evaluate(() => document.activeElement.querySelector("input")?.id), "fileInput", "Tab reaches Open netlist");
          const chooser = page.waitForEvent("filechooser");
          await page.keyboard.press("Enter");
          await (await chooser).setFiles([]);
          await page.keyboard.press("Escape");
        }
        for (let attempt = 0; attempt < 5; attempt++) await upload(page, "fileInput", []);

        await click(page, "#helpButton");
        await page.locator("#helpDialog").waitFor({ state: "visible" });
        await expectInsideViewport(page, page.locator("#helpDialog"), "keyboard help dialog");
        await page.keyboard.press("Escape");
        await page.locator("#helpDialog").waitFor({ state: "hidden" });
        assert.equal(await page.evaluate(() => document.activeElement.id), "helpButton", "Help returns keyboard focus");
        await page.keyboard.press("/");
        assert.equal(await page.evaluate(() => document.activeElement.id), "searchInput", "/ focuses search");
        await page.keyboard.press("Escape");
        await click(page, '[data-close-panel="inspector"]');
        await page.reload();
        await page.locator("#schematicMount svg").waitFor({ timeout: 45000 });
        await expectFullWidthCanvas(page);
        await expectNoHorizontalOverflow(page);
        return { viewport, canvas, fullCanvas, topbarHeight: topbar.height, timingOverflow, completedLayouts: layoutsBefore, keyboardFileActivations: 5, mouseFileActivations: 5, hiddenPanelsPersistAfterReload: true };
      } catch (error) { await captureFailure(page, error); throw error; }
      finally { await context.close(); }
    });
  }
}

async function analysisWorkflow(browser, url) {
  await checkCase("focused-compare-inspector-workflow", async () => {
    const { context, page } = await openPage(browser, url);
    try {
      await importDesign(page, workflowSource);
      await click(page, "#toggleNavigatorButton");
      await click(page, '[data-nav-tab="hierarchy"]');
      await page.locator("#moduleHierarchyFilter").fill("peer");
      await click(page, '[data-module-hierarchy-name="peer"]');
      await page.waitForFunction(() => document.querySelector("#workspaceTitle").textContent.includes("peer"));
      await click(page, "#toggleNavigatorButton");
      await click(page, "#moduleBackButton");
      await page.waitForFunction(() => document.querySelector("#workspaceTitle").textContent.includes("top"));
      await search(page, "u_first", { moduleName: "top" });
      assert.equal((await roots(page).textContent()).trim(), "0");
      await click(page, "#focusSelectedButton");
      assert.equal((await roots(page).textContent()).trim(), "0", "Zoom does not modify Focused roots");
      await click(page, "#addFocusedRootButton");
      await waitRootCount(page, 1);
      await page.locator("#focusedViewButton.is-active").waitFor();
      await search(page, "u_other", { add: true, moduleName: "top" });
      await waitRootCount(page, 2);
      await click(page, "#focusedRootsMenu > summary");
      await page.locator("#focusedRootsFilter").click();
      await page.keyboard.press("Tab");
      const keyboardRoot = await page.evaluate(() => document.activeElement.dataset.focusedRootActivate);
      assert.ok(keyboardRoot, "Tab reaches a real root activation button");
      await page.keyboard.press("Enter");
      await page.waitForFunction((rootId) => document.activeElement.dataset.focusedRootActivate === rootId, keyboardRoot);
      assert.equal((await roots(page).textContent()).trim(), "2", "Keyboard activation preserves the complete roots list");
      await page.keyboard.press("Escape");
      await search(page, "u_second", { moduleName: "top" });
      await click(page, "#setFocusedRootButton");
      await waitRootCount(page, 1);
      await click(page, "#focusedRootsMenu > summary");
      await expectInsideViewport(page, page.locator("#focusedRootsList"), "complete Focused roots list");
      assert.match(await page.locator("#focusedRootsList").textContent(), /u_second/);
      await page.keyboard.press("Escape");
      await screenshot(page, "focused-root-actions");
      await click(page, "#wholeViewButton");
      await page.locator("#wholeViewButton.is-active").waitFor();
      await click(page, "#moduleBackButton");
      await page.locator("#focusedViewButton.is-active").waitFor();
      await click(page, "#moduleForwardButton");
      await page.locator("#wholeViewButton.is-active").waitFor();

      const timing = `@module top\npoint kind edge delay slew at rt slack\nu_first/A pin r 0.001 0.002 0.10 0.15 0.05\nu_first/Y pin r 0.050 0.003 0.15 0.14 -0.01`;
      await upload(page, "timingInput", file("ui-timing.txt", timing));
      await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("ui-timing.txt"));
      await search(page, "u_first", { moduleName: "top" });
      await click(page, '[data-inspector-tab="timing"]');
      await page.locator(".timing-table-wrap").waitFor();
      await click(page, "#resetTimingBadgeButton");
      await expectNoHorizontalOverflow(page);
      await screenshot(page, "timing-details");

      await click(page, '[data-inspector-tab="connections"]');
      const netLink = page.locator('[data-selection-target-kind="net"][data-selection-target-name="n"]').first();
      await netLink.click();
      await page.locator("[data-route-net]").waitFor();
      await page.locator("[data-route-net]").uncheck();
      await page.locator('#schematicMount .edge[data-net="n"]').waitFor({ state: "detached" });
      await page.locator("[data-route-net]").check();
      await page.locator('#schematicMount .edge[data-net="n"]').first().waitFor();

      await search(page, "u_first", { moduleName: "top" });
      await click(page, "#adjustLayoutButton");
      await click(page, '[data-inspector-tab="adjust"]');
      await expectInsideViewport(page, page.locator("#nodeWidthInput"), "selected instance width");
      const initialWidth = Number(await page.locator("#nodeWidthInput").inputValue());
      await page.locator("#nodeWidthInput").fill(String(initialWidth + 16));
      await page.waitForFunction((width) => Number(document.querySelector('#schematicMount [data-node-id="cell:u_first"] .node-shape').getAttribute("width")) === width, initialWidth + 16);
      await click(page, "#resetNodeSizeButton");
      await page.waitForFunction((width) => Number(document.querySelector('#schematicMount [data-node-id="cell:u_first"] .node-shape').getAttribute("width")) === width, initialWidth);
      await screenshot(page, "adjust-instance-controls");
      await click(page, "#adjustLayoutButton");

      await click(page, "#compareButton");
      await page.locator("#leftSchematicMount svg").waitFor();
      await page.locator("#rightSchematicMount svg").waitFor();
      for (const id of ["leftModuleSelect", "rightModuleSelect", "applyCompareButton", "compareLayoutSelect"]) {
        await expectInsideViewport(page, page.locator(`#${id}`), `Compare ${id}`);
      }
      await page.locator("#leftModuleSelect").selectOption("top");
      await page.locator("#rightModuleSelect").selectOption("peer");
      await click(page, "#applyCompareButton");
      await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Compare ready"));
      assert.equal(await page.locator("#exportSvgButton").isDisabled(), true);
      assert.equal(await page.locator("#saveGoldenButton").isDisabled(), true);
      await click(page, "#fitButton");
      const initialVerticalCanvases = await expectCompareCanvasGeometry(page, "vertical", { checkNodes: true });
      await page.locator("#compareLayoutSelect").selectOption("horizontal");
      await page.locator("#compareMount.is-horizontal").waitFor();
      await click(page, "#fitButton");
      const horizontalCanvases = await expectCompareCanvasGeometry(page, "horizontal", { checkNodes: true });
      await node(page, "u_first", "#leftSchematicMount").click();
      await expectInsideViewport(page, page.locator("[data-inspector-summary]"), "Compare selected summary");
      assert.match(await page.locator(".inspector-object-scope").innerText(), /^A · Compare · top/);
      await page.locator('[data-compare-side="left"].is-active-side').waitFor();
      assert.equal(await page.locator('[data-compare-side="right"].is-active-side').count(), 0);
      await click(page, "#fitButton");
      await expectCompareCanvasGeometry(page, "horizontal", { checkNodes: true });
      await screenshot(page, "compare-horizontal");
      await page.locator("#compareLayoutSelect").selectOption("vertical");
      await click(page, "#fitButton");
      const verticalCanvases = await expectCompareCanvasGeometry(page, "vertical", { checkNodes: true });
      await node(page, "u_first", "#rightSchematicMount").click();
      assert.match(await page.locator(".inspector-object-scope").innerText(), /^B · Compare · peer/);
      await page.locator('[data-compare-side="right"].is-active-side').waitFor();
      assert.equal(await page.locator('[data-compare-side="left"].is-active-side').count(), 0);
      await click(page, "#fitButton");
      await expectCompareCanvasGeometry(page, "vertical", { checkNodes: true });
      await screenshot(page, "compare-vertical");
      await expectNoHorizontalOverflow(page);
      await click(page, "#exitCompareButton");
      await page.locator("#schematicMount svg").waitFor();

      await upload(page, "libertyInput", file("broken.lib", "library("));
      await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("failed"));
      assert.equal(await page.locator("#toggleProcessLogButton").getAttribute("aria-expanded"), "true");
      assert.ok(await node(page, "u_first").count(), "Invalid optional library keeps the active design");
      await expectInsideViewport(page, page.locator("#toggleProcessLogButton"), "log toggle after failure");
      await screenshot(page, "library-error-log");
      await click(page, "#toggleProcessLogButton");
      return { rootOperations: ["zoom", "add", "append-search", "replace", "history"], compare: ["vertical", "horizontal", "vertical", "A", "B"], initialVerticalCanvases, horizontalCanvases, verticalCanvases };
    } catch (error) { await captureFailure(page, error); throw error; }
    finally { await context.close(); }
  });
}

async function boundedInspector(browser, url) {
  await checkCase("long-names-bounded-connections", async () => {
    const { context, page } = await openPage(browser, url);
    try {
      const instance = `u_${"long_hierarchical_instance_name_".repeat(5)}`;
      const pins = Array.from({ length: 105 }, (_, index) => `.A${String(index).padStart(3, "0")}(a)`).join(",");
      const source = `module long_design(input a,output y); ODD ${instance} (${pins},.Y(y)); endmodule`;
      await importDesign(page, source, "wide-cell.v", instance);
      await search(page, instance);
      await click(page, '[data-inspector-tab="connections"]');
      const table = page.locator('[data-inspection-list="connections"]');
      await table.waitFor();
      const firstPageRows = await table.locator("tbody tr").count();
      assert.ok(firstPageRows > 0 && firstPageRows <= 100, `Initial connection rows: ${firstPageRows}`);
      const detailsBox = await page.locator("#selectionDetails").boundingBox();
      await page.mouse.move(detailsBox.x + detailsBox.width / 2, detailsBox.y + detailsBox.height - 30);
      await page.mouse.wheel(0, 1500);
      await page.waitForFunction(() => document.querySelector("#selectionDetails").scrollTop > 0);
      const stickySummary = await expectInsideViewport(page, page.locator("[data-inspector-summary]"), "scrolled object summary");
      const stickyTabs = await expectInsideViewport(page, page.locator("[data-inspector-tabs]"), "scrolled Inspector tabs");
      assert.ok(stickySummary.y >= detailsBox.y - 1 && stickyTabs.y >= stickySummary.y + stickySummary.height - 1, "Summary and tabs remain visible without overlapping");
      const next = page.locator('[data-inspection-page-group="connections"][data-inspection-page="1"]');
      await next.click();
      assert.match(await table.textContent(), /A104|\bY\b/, "Pagination reaches the tail of the complete pin list");
      await expectNoHorizontalOverflow(page);
      await screenshot(page, "long-name-connections-page-2");
      return { firstPageRows, pinCount: 106, instanceLength: instance.length };
    } catch (error) { await captureFailure(page, error); throw error; }
    finally { await context.close(); }
  });
}

async function searchFirst(browser, url) {
  await checkCase("search-first-focused-reveal", async () => {
    const { context, page } = await openPage(browser, url);
    try {
      const cells = Array.from({ length: 520 }, (_, index) => `BUF u_${index} (.A(${index ? `n${index - 1}` : "a"}),.Y(${index === 519 ? "y" : `n${index}`}));`).join("\n");
      await importDesign(page, `module large(input a,output y); ${cells} endmodule`, "search-first.v", null);
      await page.locator(".search-first-empty").waitFor();
      assert.equal(await page.locator("#schematicMount .node").count(), 0, "Search-first does not lay out Whole automatically");
      await screenshot(page, "search-first");
      await search(page, "u_300");
      await node(page, "u_300").waitFor();
      await waitRootCount(page, 1);
      await expectInsideViewport(page, page.locator("[data-inspector-summary]"), "Search-first selection");
      const visibleNodes = await page.locator("#schematicMount .node").count();
      assert.ok(visibleNodes < 30, `Search reveals a bounded neighborhood: ${visibleNodes}`);
      return { indexedCells: 520, visibleNodes };
    } catch (error) { await captureFailure(page, error); throw error; }
    finally { await context.close(); }
  });
}

async function compactCases(browser, url) {
  for (const width of [1024, 760]) {
    await checkCase(`compact-${width}`, async () => {
      const { context, page } = await openPage(browser, url, { width, height: 768 });
      try {
        assert.equal(await page.locator("#navigatorPanel").isVisible(), false);
        assert.equal(await page.locator("#inspectorPanel").isVisible(), false);
        await expectInsideViewport(page, page.locator("#canvas"), "compact canvas");
        await expectNoHorizontalOverflow(page);
        for (const id of ["fileInput", "libertyInput", "cellConfigInput", "layoutProviderSelect", "gateSymbolModeSelect", "timingMetricSelect"]) {
          const target = page.locator(`#${id}`);
          await revealDisclosure(target);
          await expectInsideViewport(page, target.locator("xpath=ancestor::*[contains(concat(' ',normalize-space(@class),' '),' toolbar-menu-popover ')][1]"), `${id} compact popup`);
          await page.keyboard.press("Escape");
          assert.equal(await page.evaluate(() => document.activeElement.tagName), "SUMMARY", "Escape restores menu trigger focus");
        }
        await search(page, "l_resyn3_u_gen_1395");
        assert.equal(await page.locator("#inspectorPanel").isVisible(), false, "Selection keeps compact canvas unobstructed");
        await click(page, "#toggleInspectorButton");
        await expectInsideViewport(page, page.locator("[data-inspector-summary]"), "compact selected object");
        await click(page, '[data-inspector-tab="timing"]');
        await expectNoHorizontalOverflow(page);
        await screenshot(page, `compact-inspector-${width}`);
        await click(page, "#toggleNavigatorButton");
        assert.equal(await page.locator("#inspectorPanel").isVisible(), false, "Compact drawers are exclusive");
        await expectInsideViewport(page, page.locator("#navigatorPanel"), "compact Navigator");
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#navigatorPanel").isVisible(), false);
        assert.equal(await page.evaluate(() => document.activeElement.id), "toggleNavigatorButton");

        await click(page, "#toggleInspectorButton");
        await page.keyboard.press("/");
        await page.locator("#searchInput").fill("l_resyn3_u_gen_1390");
        await page.locator("#searchResults").waitFor();
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#searchResults").isVisible(), false);
        assert.equal(await page.locator("#inspectorPanel").isVisible(), true, "First Escape only closes Search");
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#inspectorPanel").isVisible(), false, "Second Escape closes the drawer");
        assert.equal(await page.evaluate(() => document.activeElement.id), "toggleInspectorButton");
        await click(page, "#compareButton");
        await page.locator("#leftSchematicMount svg").waitFor();
        for (const id of ["leftModuleSelect", "rightModuleSelect", "applyCompareButton", "compareLayoutSelect"]) {
          await expectInsideViewport(page, page.locator(`#${id}`), `compact Compare ${id}`);
        }
        await expectCompareCanvasGeometry(page, "vertical");
        await expectNoHorizontalOverflow(page);
        await screenshot(page, `compact-compare-${width}`);
        await click(page, "#exitCompareButton");
        return { viewport: { width, height: 768 }, escapeOrder: ["search", "drawer"], exclusiveDrawers: true };
      } catch (error) { await captureFailure(page, error); throw error; }
      finally { await context.close(); }
    });
  }
}

async function responseObservations(browser, url) {
  await checkCase("response-observations", async () => {
    const { context, page } = await openPage(browser, url);
    try {
      await search(page, "l_resyn3_u_gen_1395");
      await click(page, '[data-inspector-tab="timing"]');
      await click(page, '[data-inspector-tab="connections"]');
      await click(page, "#toggleInspectorButton");
      await click(page, "#toggleInspectorButton");
      const layoutsBefore = await layoutCount(page);
      const startedAt = await page.evaluate(() => performance.now());
      for (let index = 0; index < 20; index++) await click(page, "#toggleInspectorButton");
      for (let index = 0; index < 20; index++) await click(page, `[data-inspector-tab="${index % 2 ? "connections" : "timing"}"]`);
      for (let index = 0; index < 20; index++) await search(page, index % 2 ? "l_resyn3_u_gen_1395" : "l_resyn3_u_gen_1390");
      await page.waitForFunction((startedAt) => window.__ngbUiObservations.interactions.filter((entry) => entry.startTime >= startedAt).length >= 60, startedAt);
      const observation = await page.evaluate((startedAt) => ({
        interactions: window.__ngbUiObservations.interactions.filter((entry) => entry.startTime >= startedAt),
        longTasks: window.__ngbUiObservations.longTasks.filter((entry) => entry.startTime >= startedAt),
        userAgent: navigator.userAgent
      }), startedAt);
      const samples = Object.fromEntries(["panel", "tab", "selection"].map((kind) => {
        const values = observation.interactions.filter((entry) => entry.kind === kind).map((entry) => entry.duration).sort((a, b) => a - b);
        assert.equal(values.length, 20, `${kind} has 20 observed real clicks`);
        return [kind, { count: values.length, p95Ms: values[Math.ceil(values.length * .95) - 1], maximumMs: values.at(-1) }];
      }));
      assert.equal(await layoutCount(page), layoutsBefore, "60 UI interactions add no provider work");
      return { measurement: "captured DOM click to second animation frame; warmed built-in sample", samples,
        longTasks: observation.longTasks, userAgent: observation.userAgent,
        meetsTargets: Object.values(samples).every((sample) => sample.p95Ms < 100) && observation.longTasks.every((task) => task.duration <= 50) };
    } catch (error) { await captureFailure(page, error); throw error; }
    finally { await context.close(); }
  });
}

try {
  await runBrowserTest(async ({ browser, url }) => {
    await layoutCases(browser, url);
    await analysisWorkflow(browser, url);
    await boundedInspector(browser, url);
    await searchFirst(browser, url);
    await compactCases(browser, url);
    await responseObservations(browser, url);
    assert.deepEqual(report.errors, [], "No unexpected page errors");
    assert.deepEqual(report.requestFailures, [], "No failed runtime resource requests");
    assert.deepEqual(report.externalRequests, [], "Runtime requests only its local offline server");
  }, { root, chromium, executablePath: process.env.NGB_CHROME });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = { ...report.failure, case: currentCase, message: error.message, stack: error.stack };
  if (currentPage && !currentPage.isClosed()) {
    try { await screenshot(currentPage, "failure"); } catch {}
    try { report.failure.visibleText = await currentPage.locator("body").innerText(); } catch {}
  }
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(artifactDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, failure: report.failure?.message, artifacts: artifactDirectory }));
}
