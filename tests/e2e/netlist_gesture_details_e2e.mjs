import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const moduleText = (name) => `module ${name}(input a, output y); wire [32:0] n; assign n[0]=a;
  ${Array.from({ length: 32 }, (_, i) => `BUF u${i} (.A(n[${i}]), .Y(n[${i + 1}]));`).join("\n")}
  assign y=n[32]; endmodule`;
const cases = [];

await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__gestureSaves = [];
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...args) {
      if (document.querySelector("#canvas")?.matches(".is-panning,.is-view-interacting")) window.__gestureSaves.push(args[0]);
      return save.apply(this, args);
    };
  });
  await page.goto(url);
  await page.locator("#fileInput").setInputFiles({ name: "gestures.v", mimeType: "text/plain",
    buffer: Buffer.from(moduleText("top") + "\n" + moduleText("alt")) });
  await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded gestures.v"));
  await page.locator("#wholeViewButton").click();
  await page.waitForFunction(() => document.querySelectorAll('#schematicMount [data-kind="cell"]').length === 32 &&
    !/^(Layout|Rendering)/.test(document.querySelector("#statusBar").textContent));
  assert.equal(await page.locator("#layoutProviderSelect").inputValue(), DEFAULT_LAYOUT_PROVIDER_ID);
  const canvas = page.locator("#canvas");

  await exercise("#schematicMount", "Single");
  // Search still resolves the complete graph after repeated preview/restoration.
  await page.locator("#searchInput").fill("u0");
  await page.locator(".search-result").filter({ has: page.locator(".search-result-label", { hasText: /^u0$/ }) }).first().locator("[data-search-index]").click();
  await page.locator("#focusSelectedButton").click();
  assert.equal(await page.locator("#schematicMount .node.is-selected").getAttribute("data-node-id"), "cell:u0");
  const focusOrigin = await beginPan("#schematicMount");
  await page.locator("#focusSelectedButton").press("Enter");
  await page.waitForFunction(() => !document.querySelector("#canvas").classList.contains("is-panning"), null, { timeout: 5000 });
  const focusedTransform = await transform("#schematicMount");
  await page.mouse.move(focusOrigin.x + 70, focusOrigin.y + 30); await page.mouse.up();
  await page.waitForTimeout(50);
  assert.equal(await transform("#schematicMount"), focusedTransform, "Focus rejects stale pan input");
  cases.push("Focus while panning owns the new viewport");
  await page.locator("#fitButton").click();
  const labelCount = await page.locator("#schematicMount text").count();
  const exportButton = page.locator("#exportSvgButton");
  await openMenus(exportButton);
  await page.keyboard.press("Escape");
  await beginPan("#schematicMount");
  const downloadReady = page.waitForEvent("download");
  await exportButton.evaluate((button) => button.click());
  const svg = await readFile(await (await downloadReady).path(), "utf8");
  assert.equal((svg.match(/<text\b/g) || []).length, labelCount);
  assert.doesNotMatch(svg, /is-panning|is-view-interacting/);
  await page.mouse.up();
  await restored("#schematicMount");

  await clickVisible("#compareButton");
  await page.locator("#leftModuleSelect").selectOption("top");
  await page.locator("#rightModuleSelect").selectOption("alt");
  await clickVisible("#applyCompareButton");
  await page.waitForFunction(() => document.querySelector("#leftSchematicMount .node") && document.querySelector("#rightSchematicMount .node"));
  await exercise("#leftSchematicMount", "Compare synced");
  await openMenus(page.locator("#syncCompareInput"));
  await page.locator("#syncCompareInput").uncheck();
  await page.keyboard.press("Escape");
  await exercise("#rightSchematicMount", "Compare independent");
  const replacement = moduleText("replacement") + "\n" + moduleText("alternate");
  await replaceDuringGesture("#rightSchematicMount", "pan", "#fileInput", "replacement.v", replacement, ".node");
  await replaceDuringGesture("#schematicMount", "wheel", "#fileInput", "replacement2.v", replacement, ".node");
  const aigText = await readFile(new URL("../fixtures/aig/shared_cone.blif", import.meta.url), "utf8");
  await replaceDuringGesture("#schematicMount", "pan", "#aigFileInput", "replacement.blif", aigText, "[data-aig-node]");
  await replaceDuringGesture("#schematicMount", "pan", "#fileInput", "returned.v", replacement, ".node");
  await replaceDuringGesture("#schematicMount", "drag", "#fileInput", "after_drag.v", replacement, ".node");
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__gestureSaves), []);

  async function exercise(mount, name) {
    await page.locator("#fitButton").click();
    await restored(mount);
    const original = await geometry(mount);
    for (const ending of ["up", "cancel", "lost", "fit", "wheel"]) {
      const origin = await beginPan(mount);
      assert.ok(await page.locator(`${mount} .gate-kind`).evaluateAll((labels) => labels.length > 0 &&
        labels.every((label) => getComputedStyle(label).display !== "none" && getComputedStyle(label).visibility === "hidden")), "pan retains text layout");
      if (ending === "up") await page.mouse.up();
      if (ending === "cancel") await canvas.evaluate((element) => element.dispatchEvent(new PointerEvent("pointercancel", { pointerId: window.__gesturePointer, bubbles: true })));
      if (ending === "lost") {
        await canvas.evaluate((element) => element.releasePointerCapture(window.__gesturePointer));
        await page.mouse.move(origin.x + 60, origin.y + 30);
      }
      if (ending === "fit") await page.locator("#fitButton").press("Enter");
      if (ending === "wheel") await page.mouse.wheel(0, -40);
      await restored(mount);
      const settled = await transform(mount);
      await page.mouse.move(origin.x + 70, origin.y + 40);
      await page.mouse.up();
      await page.waitForTimeout(50);
      assert.equal(await transform(mount), settled, `${name}: ${ending} rejects late pan input`);
      assert.deepEqual(await geometry(mount), original);
    }
    await page.locator("#fitButton").click();
    const origin = await blankPoint(mount);
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.wheel(0, -40);
    await page.waitForFunction((mount) => document.querySelector("#canvas").classList.contains("is-view-interacting") &&
      [...document.querySelectorAll(`${mount} .gate-kind`)].every((label) => getComputedStyle(label).display === "none"), mount);
    await restored(mount);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("#fitButton").click();
    await restored(mount);
    assert.deepEqual(await geometry(mount), original);
    cases.push(`${name}: pan, wheel, takeover, cancel, capture loss, Fit, resize and complete details`);
  }
  async function beginPan(mount) {
    const point = await blankPoint(mount);
    await canvas.evaluate((element) => element.addEventListener("pointerdown", (event) => { window.__gesturePointer = event.pointerId; }, { once: true }));
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 35, point.y + 15);
    await page.waitForFunction(() => document.querySelector("#canvas").classList.contains("is-panning"));
    return point;
  }
  async function replaceDuringGesture(mount, kind, input, name, text, nodeSelector) {
    let origin = kind === "pan" ? await beginPan(mount) : await blankPoint(mount);
    if (kind === "drag") {
      await page.locator("#adjustLayoutButton").click();
      const node = page.locator(`${mount} .node[data-kind="cell"] .node-shape`).first();
      const box = await node.boundingBox();
      origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(origin.x, origin.y); await page.mouse.down();
      await page.mouse.move(origin.x + 20, origin.y + 15);
      await page.waitForFunction(() => document.querySelector("#canvas").classList.contains("is-node-dragging"));
    }
    if (kind === "wheel") {
      await page.mouse.move(origin.x, origin.y);
      await page.mouse.wheel(0, -40);
    }
    await page.locator(input).setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
    await page.waitForFunction((name) => document.querySelector("#statusBar").textContent.includes(`Loaded ${name}`), name);
    await page.waitForFunction((selector) => !document.querySelector("#schematicMount").hidden && document.querySelector(`#schematicMount ${selector}`), nodeSelector);
    await page.waitForFunction(() => !document.querySelector("#canvas").matches(".is-panning,.is-view-interacting,.is-node-dragging"));
    const committed = await transform("#schematicMount");
    await page.mouse.move(origin.x + 70, origin.y + 40); await page.mouse.up();
    await page.waitForTimeout(300);
    assert.equal(await transform("#schematicMount"), committed, `${name}: old input must not alter a replacement graph`);
    assert.equal(await page.locator(".is-drag-preview-node,.is-drag-preview-edge").count(), 0);
    assert.ok(await page.locator(`#schematicMount ${nodeSelector}`).count() > 0);
    cases.push(`${name}: ${kind} cancelled on workspace replacement`);
  }
  async function blankPoint(mount) {
    return page.locator(mount).evaluate((element) => {
      const box = element.getBoundingClientRect();
      for (const x of [5, 20, 80]) for (const y of [5, 20, 80]) {
        const point = { x: box.x + x, y: box.y + y }, hit = document.elementFromPoint(point.x, point.y);
        if (element.contains(hit) && !hit.closest("[data-node-id],[data-edge-id],[data-domain-object]")) return point;
      }
      throw new Error("No blank pan origin");
    });
  }
  async function restored(mount) {
    await page.waitForFunction((mount) => !document.querySelector("#canvas").matches(".is-panning,.is-view-interacting") &&
      [...document.querySelectorAll(`${mount} text,${mount} .wire-bridge,${mount} .wire-bridge-cutout`)]
        .every((element) => getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility === "visible") &&
      [...document.querySelectorAll(`${mount} .wire-hit-area`)].every((element) => getComputedStyle(element).pointerEvents === "stroke"), mount);
  }
  function transform(mount) { return page.locator(`${mount} .schematic-content`).getAttribute("transform"); }
  function geometry(mount) { return page.locator(`${mount} svg`).evaluate((svg) => [...svg.querySelectorAll("[d],[points],[x],[y],[cx]")]
    .map((element) => [element.tagName, ...["d", "points", "x", "y", "cx", "cy", "width", "height"].map((key) => element.getAttribute(key))])); }
  async function openMenus(target) {
    for (const menu of await target.locator("xpath=ancestor::details").all()) if (!await menu.evaluate((element) => element.open)) await menu.locator(":scope > summary").click();
  }
  async function clickVisible(selector) { const target = page.locator(selector); await openMenus(target); await target.click(); }
}, { root, chromium, executablePath: process.env.NGB_CHROME });
console.log(JSON.stringify({ status: "passed", provider: DEFAULT_LAYOUT_PROVIDER_ID, cases }, null, 2));
