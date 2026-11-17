import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const shared = await readFile(new URL("../fixtures/aig/shared_cone.blif", import.meta.url), "utf8");
const outputs = Array.from({ length: 210 }, (_, index) => `out_${String(index).padStart(3, "0")}`);
const paged = `.model panels\n.inputs 雪\n.outputs ${outputs.join(" ")}\n${outputs.map((name) => `.names 雪 ${name}\n1 1`).join("\n")}\n.end`;
const cases = [];

async function load(page, name, text) {
  await page.locator("#aigFileInput").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  await page.waitForFunction((name) => document.querySelector("#statusBar").textContent.includes(`Loaded ${name}`), name);
}

async function panel(page, name, open) {
  const toggle = page.locator(`#toggle${name}Button`);
  if (await toggle.getAttribute("aria-expanded") !== String(open)) await toggle.click();
}

async function activeData(page, field) {
  return page.evaluate((field) => document.activeElement?.dataset[field] ?? null, field);
}

await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await load(page, "panels.blif", paged);
  await panel(page, "Navigator", true);
  await page.locator('[data-aig-nav-tab="objects"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(await activeData(page, "aigNavTab"), "objects");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await activeData(page, "aigNavTab"), "design");
  await page.keyboard.press("ArrowRight");
  assert.equal(await activeData(page, "aigNavTab"), "objects");
  await page.locator('[data-aig-nav-tab="objects"]').press("Space");
  assert.equal(await activeData(page, "aigNavTab"), "objects");

  await page.locator('#domainNavigator [data-aig-page="1"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(await activeData(page, "aigPage"), "2");
  await page.keyboard.press("Enter");
  assert.equal(await activeData(page, "aigPage"), "1", "last-page focus moves to the enabled Previous button");
  assert.match(await page.locator("#domainNavigator").innerText(), /Page 3 \/ 3/);
  const selected = page.locator("#domainNavigator [data-aig-select]").first();
  const selectedId = await selected.getAttribute("data-aig-select");
  await selected.focus();
  await page.keyboard.press("Enter");
  assert.equal(await activeData(page, "aigSelect"), selectedId);
  assert.equal(await page.locator("[data-aig-inspected-id]").getAttribute("data-aig-inspected-id"), selectedId);
  await page.locator('[data-aig-inspector-tab="source"]').focus();
  await page.keyboard.press("Enter");
  assert.equal(await activeData(page, "aigInspectorTab"), "source");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await activeData(page, "aigInspectorTab"), "analysis");
  cases.push("panel tabs, page boundaries and selection retain keyboard focus");

  // Use Chrome's actual IME composition path; replacing the input mid-composition
  // would detach this reference and cancel the browser's composing session.
  const query = page.locator('[data-aig-filter="query"]');
  await query.focus();
  await page.waitForTimeout(200);
  await query.evaluate((input) => {
    window.__aigComposingInput = input;
    window.__aigFilterRenders = 0;
    window.__aigFilterObserver = new MutationObserver((records) => { window.__aigFilterRenders += records.length; });
    window.__aigFilterObserver.observe(document.querySelector("#domainNavigator"), { childList: true });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "雪", selectionStart: 1, selectionEnd: 1 });
  assert.equal(await page.evaluate(() => window.__aigComposingInput.isConnected), true);
  assert.equal(await page.evaluate(() => window.__aigFilterRenders), 0);
  await cdp.send("Input.insertText", { text: "雪" });
  assert.equal(await query.inputValue(), "雪");
  assert.equal(await page.evaluate(() => window.__aigFilterRenders), 1, "the committed text filters once");
  assert.match(await page.locator("#domainNavigator").innerText(), /1 objects/);
  await page.evaluate(() => window.__aigFilterObserver.disconnect());
  await cdp.detach();
  cases.push("IME keeps the original input until its final text is committed once");

  await load(page, "gestures.blif", shared);
  assert.equal(await page.locator('[data-aig-nav-tab="design"]').getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("[data-aig-inspected-id]").count(), 0);
  await panel(page, "Navigator", false);
  await panel(page, "Inspector", true);
  await page.locator("#fitButton").click();
  await page.waitForTimeout(200);
  const zoomResize = await page.evaluate(async () => {
    const content = document.querySelector("#schematicContent"), canvas = document.querySelector("#canvas");
    const box = canvas.getBoundingClientRect();
    const anchor = new DOMPoint(box.x + box.width / 4, box.y + box.height / 3);
    const anchorBefore = anchor.matrixTransform(content.getScreenCTM().inverse());
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: anchor.x,
      clientY: anchor.y, bubbles: true, cancelable: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const anchorAfter = anchor.matrixTransform(content.getScreenCTM().inverse());
    const before = content.getScreenCTM().a;
    document.querySelector("#toggleInspectorButton").click();
    const immediate = content.getScreenCTM().a;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { before, immediate, after: content.getScreenCTM().a,
      anchorBefore: { x: anchorBefore.x, y: anchorBefore.y }, anchorAfter: { x: anchorAfter.x, y: anchorAfter.y } };
  });
  assert.ok(Math.abs(zoomResize.anchorBefore.x - zoomResize.anchorAfter.x) < 0.1, JSON.stringify(zoomResize));
  assert.ok(Math.abs(zoomResize.anchorBefore.y - zoomResize.anchorAfter.y) < 0.1, JSON.stringify(zoomResize));
  assert.ok(Math.abs(zoomResize.immediate - zoomResize.before) < 0.002, JSON.stringify(zoomResize));
  assert.ok(Math.abs(zoomResize.after - zoomResize.before) < 0.002, JSON.stringify(zoomResize));
  cases.push("closing a docked panel preserves a pending wheel zoom");

  await panel(page, "Inspector", true);
  await page.locator("#fitButton").click();
  await page.waitForTimeout(200);
  const panResize = await page.evaluate(async () => {
    const content = document.querySelector("#schematicContent"), svg = content.ownerSVGElement;
    const read = () => {
      const rect = svg.getBoundingClientRect();
      const point = new DOMPoint(rect.x + rect.width / 2, rect.y + rect.height / 2).matrixTransform(content.getScreenCTM().inverse());
      const origin = new DOMPoint(0, 0).matrixTransform(content.getScreenCTM());
      return { x: point.x, y: point.y, scale: content.getScreenCTM().a, screenX: origin.x, screenY: origin.y };
    };
    window.__aigPanRead = read;
    return read();
  });
  const canvasBox = await page.locator("#canvas").boundingBox();
  await page.mouse.move(canvasBox.x + 8, canvasBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 68, canvasBox.y + 38);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const panBeforeResize = await page.evaluate(() => window.__aigPanRead());
  assert.ok(Math.abs(panBeforeResize.x - panResize.x) > 1, "the pointer drag has painted a pan preview");
  assert.ok(Math.abs(panBeforeResize.screenX - panResize.screenX - 60) < 0.1, JSON.stringify({ panResize, panBeforeResize }));
  assert.ok(Math.abs(panBeforeResize.screenY - panResize.screenY - 30) < 0.1, JSON.stringify({ panResize, panBeforeResize }));
  await page.locator("#toggleInspectorButton").evaluate((button) => button.click());
  await page.mouse.up();
  const panAfterResize = await page.evaluate(() => window.__aigPanRead());
  // SVG transforms intentionally serialize to three decimal places. The toolbar
  // changes the fit ratio; measure the centre error in screen pixels rather than
  // imposing a fixed model-unit epsilon on every magnification.
  const centreErrorPixels = Math.hypot(panAfterResize.x - panBeforeResize.x,
    panAfterResize.y - panBeforeResize.y) * panBeforeResize.scale;
  assert.ok(centreErrorPixels < 0.5, JSON.stringify({ panBeforeResize, panAfterResize, centreErrorPixels }));
  assert.ok(Math.abs(panAfterResize.scale - panBeforeResize.scale) < 0.002);
  cases.push("closing a docked panel preserves an active pan and ignores its late release");

  await panel(page, "Inspector", true);
  await page.locator("#fitButton").click();
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 1600, height: 1200 });
  const resizeZoom = await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const content = document.querySelector("#schematicContent"), rect = content.ownerSVGElement.getBoundingClientRect();
    const before = content.getScreenCTM().a;
    const pending = JSON.parse(sessionStorage.getItem("ngb.domain-workspace.v1")).viewport.scale !== content.transform.baseVal.getItem(0).matrix.a;
    document.querySelector("#canvas").dispatchEvent(new WheelEvent("wheel", { deltaY: -100,
      clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, bubbles: true, cancelable: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const immediate = content.getScreenCTM().a;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { before, immediate, after: content.getScreenCTM().a, pending };
  });
  assert.equal(resizeZoom.pending, true, "the window resize is still a transient preview before the wheel event");
  assert.ok(Math.abs(resizeZoom.immediate / resizeZoom.before - 1.12) < 0.002, JSON.stringify(resizeZoom));
  assert.ok(Math.abs(resizeZoom.after - resizeZoom.immediate) < 0.002, JSON.stringify(resizeZoom));
  cases.push("wheel takes over a pending window resize without a magnification jump");

  await page.setViewportSize({ width: 1400, height: 1200 });
  await panel(page, "Navigator", false);
  await page.locator("#fitButton").click();
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const resizePanStart = await page.evaluate(() => window.__aigPanRead());
  const resizedCanvas = await page.locator("#canvas").boundingBox();
  await page.mouse.move(resizedCanvas.x + 8, resizedCanvas.y + 8);
  await page.mouse.down();
  await page.mouse.move(resizedCanvas.x + 68, resizedCanvas.y + 38);
  await page.mouse.up();
  const resizePanEnd = await page.evaluate(() => window.__aigPanRead());
  assert.ok(Math.abs(resizePanStart.scale - resizePanEnd.scale) < 0.002, JSON.stringify({ resizePanStart, resizePanEnd }));
  assert.ok(Math.abs(resizePanEnd.screenX - resizePanStart.screenX - 60) < 0.1, JSON.stringify({ resizePanStart, resizePanEnd }));
  assert.ok(Math.abs(resizePanEnd.screenY - resizePanStart.screenY - 30) < 0.1, JSON.stringify({ resizePanStart, resizePanEnd }));
  cases.push("pan takes over a pending window resize with exact pointer displacement");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ cases, errors, zoomResize, panBeforeResize, panAfterResize, resizeZoom, resizePanStart, resizePanEnd }));
}, { root, chromium, executablePath: process.env.NGB_CHROME || process.env.NGB_CHROMIUM_PATH });
