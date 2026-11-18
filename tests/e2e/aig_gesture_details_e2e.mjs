import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";
import { importAigSource } from "../../src/domains/aig/aig_import.js";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const text = await readFile(new URL("../fixtures/aig/shared_cone.blif", import.meta.url), "utf8");
const { model } = importAigSource(text, { name: "gestures.blif" });
const gate = model.nodes.find((node) => node.kind === "and" && node.sourceRefs.some((ref) => ref.id === "new_n8"));
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
  const recordedRoles = () => page.locator("[data-neighbor-role]").evaluateAll((groups) =>
    groups.map((group) => [group.dataset.aigObject, group.dataset.neighborRole]));
  for (const value of ["standard", "abc"]) {
    if (await style.inputValue() !== value) {
      await style.selectOption(value);
      await page.waitForFunction((label) => document.querySelector("#statusBar").textContent === `AIG view: ${label}`, value === "abc" ? "Logic View" : "Standard");
    }
    await page.getByLabel("Highlight connections", { exact: true }).selectOption("1");
    await page.locator("#settingsMenu > summary").click();
    await page.getByLabel("Logical critical path").setChecked(value === "standard");
    await page.keyboard.press("Escape");
    const selected = page.locator(`[data-aig-node="${gate.id}"]`);
    const id = await selected.getAttribute("data-aig-node");
    await selected.press("Enter");
    await page.waitForTimeout(250);
    const before = await geometry();
    const highlights = await recordedRoles();
    assert.deepEqual(new Set(highlights.map(([, role]) => role)), new Set(["input", "output"]));
    assert.equal(await page.locator(".aig-edge[data-neighbor-role] .aig-edge-path[data-aig-critical]").count() > 0, value === "standard");
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
      assert.deepEqual(await recordedRoles(), highlights);
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
    assert.match(svg, /filter:grayscale\(1\);opacity:\.35/, "export uses the settled appearance even during a gesture");
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
      const outside = [...document.querySelectorAll("[data-aig-object]:not(.is-selected):not([data-neighbor-role])")];
      const nodesOutside = outside.filter((group) => group.hasAttribute("data-aig-node"));
      const edgesOutside = outside.filter((group) => group.hasAttribute("data-aig-edge"));
      if (!nodesOutside.length || !edgesOutside.length || !outside.every((group) =>
        getComputedStyle(group).filter === "none" && getComputedStyle(group).opacity === "1")) return false;
      if (!nodesOutside.every((group) => getComputedStyle(group.querySelector(".aig-node-shape")).stroke === "rgb(184, 184, 184)") ||
          !edgesOutside.every((group) => getComputedStyle(group.querySelector(".aig-edge-path")).stroke === "rgb(192, 192, 192)" &&
            getComputedStyle(group.querySelector(".aig-edge-arrow")).fill === "rgb(192, 192, 192)")) return false;
      const halos = [...document.querySelectorAll("[data-neighbor-role] .aig-neighbor-halo")];
      if (!halos.length || !halos.every((halo) => getComputedStyle(halo).visibility === "visible" &&
        getComputedStyle(halo).stroke === (halo.parentElement.dataset.neighborRole === "input" ? "rgb(37, 99, 235)" : "rgb(22, 163, 74)"))) return false;
      const traceEdges = [...document.querySelectorAll(".aig-edge[data-neighbor-role]")];
      if (!traceEdges.every((edge) => {
        const base = edge.querySelector(".aig-edge-path"), halo = getComputedStyle(edge.querySelector(".aig-neighbor-halo"));
        const path = getComputedStyle(base);
        return halo.opacity === "1" && halo.strokeDasharray === path.strokeDasharray &&
          path.stroke === (base.hasAttribute("data-aig-critical") ? "rgb(220, 38, 38)" : "none");
      })) return false;
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
        [...document.querySelectorAll(".aig-edge[data-neighbor-role]")].every((edge) =>
          getComputedStyle(edge.querySelector(".aig-edge-path")).stroke !== "none" &&
          getComputedStyle(edge.querySelector(".aig-neighbor-halo")).opacity === "0.5") &&
        [...document.querySelectorAll("svg[data-aig-cone-trace] [data-aig-object]:not(.is-selected):not([data-neighbor-role])")]
          .every((group) => getComputedStyle(group).filter === "grayscale(1)" && getComputedStyle(group).opacity === "0.35") &&
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
