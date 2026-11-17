import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const text = await readFile(new URL("../fixtures/aig/shared_cone.blif", import.meta.url), "utf8");
const cases = [];

await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__gestureSaves = [];
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...args) {
      const classes = document.querySelector("#canvas")?.className || "";
      if (/is-panning|is-view-interacting/.test(classes)) window.__gestureSaves.push({ key: args[0], classes });
      return save.apply(this, args);
    };
  });
  await page.goto(url);
  await load("gestures.blif");
  const canvas = page.locator("#canvas");
  const style = page.locator('[data-domain-policy="viewStyle"]');
  for (const value of ["standard", "abc"]) {
    if (await style.inputValue() !== value) {
      await style.selectOption(value);
      await page.waitForFunction(() => document.querySelector("#statusBar").textContent === "AIG view: ABC");
    }
    const selected = page.locator("#schematicMount [data-aig-node]").nth(2);
    const id = await selected.getAttribute("data-aig-node");
    await selected.press("Enter");
    await page.waitForTimeout(250);
    const before = await geometry();
    const labels = await page.locator(".aig-node-label").count();
    assert.ok(labels > 1);

    for (const ending of ["up", "cancel", "lost", "fit", "wheel"]) {
      console.log(`${value}: ${ending}`);
      await beginPan();
      await preview(id);
      if (ending === "up") await page.mouse.up();
      if (ending === "cancel") await canvas.evaluate((element) => element.dispatchEvent(new PointerEvent("pointercancel", { pointerId: window.__gesturePointer, bubbles: true })));
      if (ending === "lost") {
        await canvas.evaluate((element) => element.releasePointerCapture(window.__gesturePointer));
        // Chrome dispatches pending capture changes before the next pointer input.
        await page.mouse.move(5, 5);
      }
      if (ending === "fit") await page.locator("#fitButton").press("Enter");
      if (ending === "wheel") await page.mouse.wheel(0, -40);
      await restored(labels);
      await page.mouse.up();
      assert.deepEqual(await geometry(), before);
    }
    await page.locator("#fitButton").click();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.wheel(0, -40);
    await preview(id);
    await restored(labels);

    // Export while a real captured pan is active; use keyboard activation so
    // the pointer remains captured. Export must read the full logical scene.
    const exportButton = page.locator("#exportSvgButton");
    for (const menu of await exportButton.locator("xpath=ancestor::details").all()) {
      if (!await menu.evaluate((element) => element.open)) await menu.locator(":scope > summary").click();
    }
    await page.keyboard.press("Escape");
    await beginPan();
    await preview(id);
    const downloaded = page.waitForEvent("download");
    await exportButton.evaluate((button) => button.click());
    const download = await downloaded;
    const svg = await readFile(await download.path(), "utf8");
    assert.equal((svg.match(/class="aig-node-label"/g) || []).length, labels);
    assert.doesNotMatch(svg, /is-panning|is-view-interacting/);
    assert.match(svg, /aig-edge-arrow/);
    await page.mouse.up();
    await restored(labels);
    cases.push(`${value}: pan, wheel takeover, cancel, capture loss, Fit and complete export`);
  }

  await beginPan();
  await style.selectOption("standard");
  await page.waitForFunction(() => document.querySelector("#statusBar").textContent === "AIG view: Standard");
  await restored(await page.locator(".aig-node-label").count());
  await page.mouse.up();
  await beginPan();
  await load("replacement.blif");
  await restored(await page.locator(".aig-node-label").count());
  await page.mouse.up();
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__gestureSaves), [], "persist only after the old gesture releases ownership");
  cases.push("style/document replacement cancels the old gesture");

  async function load(name) {
    await page.locator("#aigFileInput").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
    await page.waitForFunction((name) => document.querySelector("#statusBar").textContent.includes(`Loaded ${name}`), name);
  }
  async function beginPan() {
    await canvas.evaluate((element) => element.addEventListener("pointerdown", (event) => { window.__gesturePointer = event.pointerId; }, { once: true }));
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 45, box.y + 25);
  }
  async function preview(id) {
    await page.waitForFunction((id) => {
      const nodes = [...document.querySelectorAll(".aig-node")];
      const selected = nodes.find((node) => node.dataset.aigNode === id);
      return selected?.classList.contains("is-selected") &&
        [...selected.querySelectorAll(".aig-node-label")].every((label) => getComputedStyle(label).visibility === "visible" && getComputedStyle(label).display !== "none") &&
        nodes.filter((node) => !node.classList.contains("is-selected") && node !== document.activeElement)
          .every((node) => [...node.querySelectorAll(".aig-node-label")].every((label) => getComputedStyle(label).display === "none"));
    }, id, { timeout: 5000 }).catch(async (error) => {
      throw new Error(`${error.message}: ${JSON.stringify(await page.evaluate(() => ({
        canvas: document.querySelector("#canvas").className,
        active: document.activeElement?.outerHTML.slice(0, 200),
        selected: [...document.querySelectorAll(".aig-node.is-selected")].map((node) => node.dataset.aigNode),
        labels: [...document.querySelectorAll(".aig-node-label")].map((label) => [label.parentElement.dataset.aigNode, getComputedStyle(label).visibility, getComputedStyle(label).display])
      })))}`);
    });
    assert.ok(await page.locator('.aig-edge-path').evaluateAll((elements) => elements.every((element) => getComputedStyle(element).visibility === "visible")));
    assert.ok(await page.locator('.aig-edge-hit').evaluateAll((elements) => elements.every((element) => getComputedStyle(element).pointerEvents === "stroke")));
  }
  async function restored(count) {
    await page.waitForFunction((count) => {
      const canvas = document.querySelector("#canvas"), labels = [...document.querySelectorAll(".aig-node-label")];
      return !canvas.matches(".is-panning,.is-view-interacting") && labels.length === count &&
        labels.every((label) => getComputedStyle(label).visibility === "visible" && getComputedStyle(label).display !== "none");
    }, count, { timeout: 5000 }).catch(async (error) => {
      throw new Error(`${error.message}: ${JSON.stringify(await page.evaluate(() => ({
        canvas: document.querySelector("#canvas").className,
        labels: [...document.querySelectorAll(".aig-node-label")].map((label) => [getComputedStyle(label).visibility, getComputedStyle(label).display])
      })))}`);
    });
  }
  async function geometry() {
    return page.locator("#schematicMount svg").evaluate((svg) => [...svg.querySelectorAll(".aig-node-shape,.aig-edge-path,.aig-edge-arrow,.aig-edge-hit")]
      .map((node) => [node.tagName, ...["d", "points", "cx", "cy", "rx", "ry", "stroke", "stroke-dasharray"].map((name) => node.getAttribute(name))]));
  }
}, { root, chromium, executablePath: process.env.NGB_CHROME });
console.log(JSON.stringify({ status: "passed", cases }, null, 2));
