import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const artifacts = join(root, "dc_runs/paste_cancellation");
await mkdir(artifacts, { recursive: true });
const netlist = "module left(input a, output y); BUF u(.A(a), .Y(y)); endmodule\nmodule right(input a, output y); BUF v(.A(a), .Y(y)); endmodule";
const timing = "@module left\npoint at rt slack\nu/A 1 2 1\n@module right\npoint at rt slack\nv/A 1 2 1";
const cases = [];

await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__cancelTest = { hold: false, held: [], terminated: 0, holdFrames: false, frames: [] };
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, { construct(target, args) {
      const worker = Reflect.construct(target, args);
      if (String(args[0]).includes("native_layout_worker.js")) {
        const send = worker.postMessage.bind(worker), terminate = worker.terminate.bind(worker);
        worker.terminate = () => { window.__cancelTest.terminated++; return terminate(); };
        worker.postMessage = (...values) => {
          if (window.__cancelTest.hold) { window.__cancelTest.held.push(() => send(...values)); return; }
          return send(...values);
        };
      }
      return worker;
    } });
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => window.__cancelTest.holdFrames && document.querySelector("#statusBar")?.textContent.startsWith("Rendering ")
      ? window.__cancelTest.frames.push(callback) : requestFrame(callback);
  });
  const form = page.locator("#netlistTextForm"), dialog = page.locator("#netlistTextDialog");
  const input = page.locator("#netlistTextInput"), submit = form.locator("[data-text-submit]");
  const open = async (kind, source) => {
    await page.evaluate((id) => document.getElementById(id).click(), kind === "netlist" ? "pasteNetlistButton" : "pasteTimingButton");
    await input.fill(source);
  };
  const cancelLayout = async (kind, source, expectedJobs, selectors) => {
    await open(kind, source);
    const before = await page.evaluate(() => { window.__cancelTest.hold = true; window.__cancelTest.held = []; return window.__cancelTest.terminated; });
    await submit.click();
    await page.waitForFunction((count) => window.__cancelTest.held.length === count, expectedJobs);
    await page.locator("#cancelNetlistTextButton").click();
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await page.evaluate(() => window.__cancelTest.terminated), before + expectedJobs);
    assert.match(await page.locator("#statusBar").textContent(), /Drawing cancelled/);
    for (const selector of selectors) assert.equal(await page.locator(`${selector} svg`).count(), 0);
    await page.evaluate(() => { window.__cancelTest.hold = false; window.__cancelTest.held.forEach((release) => release()); });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.match(await page.locator("#statusBar").textContent(), /Drawing cancelled/);
    await open(kind, source);
    await submit.click();
    await page.waitForFunction(() => !document.querySelector("#netlistTextDialog").open);
    for (const selector of selectors) assert.equal(await page.locator(`${selector} svg`).count(), 1);
  };
  try {
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector("#schematicMount svg") && document.querySelector("#statusBar").textContent.includes("Loaded"));
    await cancelLayout("netlist", netlist, 1, ["#schematicMount"]);
    cases.push("Verilog Cancel terminates the real layout worker, prevents late completion and permits retry");
    await cancelLayout("timing", timing, 1, ["#schematicMount"]);
    cases.push("Single timing cancellation reaches layout and permits retry");

    await page.locator("#compareButton").click();
    await page.locator("#leftModuleSelect").selectOption("left");
    await page.locator("#rightModuleSelect").selectOption("right");
    await page.locator("#applyCompareButton").click();
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Compare ready"));
    await cancelLayout("timing", timing.replaceAll("1 2 1", "3 5 2"), 2, ["#leftSchematicMount", "#rightSchematicMount"]);
    cases.push("Compare timing cancellation terminates both layout workers without late commits");

    const outputs = Array.from({ length: 180 }, (_, i) => `y${i}`);
    const large = `module progressive(input a, output ${outputs.join(",")});\n${outputs.map((name, i) => `BUF b${i}(.A(a), .Y(${name}));`).join("\n")}\nendmodule`;
    await open("netlist", large);
    await page.evaluate(() => { window.__cancelTest.holdFrames = true; document.querySelector("#netlistTextForm").requestSubmit(); });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.startsWith("Rendering 0/"), null, { polling: 50 });
    await page.evaluate(() => document.querySelector("#cancelNetlistTextButton").click());
    await page.waitForFunction(() => document.querySelectorAll("#schematicMount svg").length === 0, null, { polling: 50, timeout: 2000 });
    assert.equal(await page.locator("#exportSvgButton").isDisabled(), true);
    await page.evaluate(() => {
      window.__cancelTest.holdFrames = false;
      window.__cancelTest.frames.splice(0).forEach((callback) => callback(performance.now()));
    });
    await page.waitForFunction(() => document.querySelectorAll("#schematicMount svg").length === 0);
    assert.match(await page.locator("#statusBar").textContent(), /Drawing cancelled/);
    await open("netlist", large);
    await submit.click();
    await page.waitForFunction(() => !document.querySelector("#netlistTextDialog").open);
    assert.ok(await page.locator("#schematicMount .node").count() > 180);
    cases.push("progressive SVG cancellation clears the partial view without waiting for animation frames and permits retry");
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, "report.json"), JSON.stringify({ cases, errors }, null, 2));
    console.log(JSON.stringify({ cases, errors }));
  } catch (error) {
    console.error(JSON.stringify({ cases, errors, state: await page.evaluate(() => ({
      status: document.querySelector("#statusBar").textContent, inlineStatus: document.querySelector("[data-text-status]").textContent,
      heldWorkers: window.__cancelTest.held.length, heldFrames: window.__cancelTest.frames.length
    })) }));
    await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
    throw error;
  }
}, { root, chromium, executablePath: process.env.NGB_CHROME });
