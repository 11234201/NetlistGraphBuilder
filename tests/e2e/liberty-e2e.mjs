import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { runBrowserTest } from "./browser_test_session.mjs";
const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const report = await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage(); const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator("#schematicMount svg").waitFor();
  const source = 'module top(input a,b,output z); ODD u(.X(a),.Y(b),.RESULT(z)); endmodule\nmodule alt(input a,b,output z); ODD v(.X(a),.Y(b),.RESULT(z)); endmodule';
  const liberty = 'library(demo){cell(ODD){pin(X){direction:input;}pin(Y){direction:input;}pin(RESULT){direction:output;function:"!(X Y)";}}}';
  const file = (name, text) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  await page.locator("#fileInput").setInputFiles(file("design.v", source));
  await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded design.v"));
  await page.locator("#libertyInput").setInputFiles(file("demo.lib", liberty));
  await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded Liberty demo.lib"));
  await page.locator('#schematicMount [data-node-id="cell:u"]').first().click({ force: true });
  assert.match(await page.locator("#selectionDetails").innerText(), /library/);
  assert.match(await page.locator("#selectionDetails").innerText(), /demo.lib/);
  await page.locator("#libertyInput").setInputFiles(file("broken.lib", "library("));
  await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("failed"));
  assert.match(await page.locator("#libertySummary").innerText(), /demo.lib/);
  await page.locator("#compareButton").evaluate((button) => button.click());
  await page.locator("#leftSchematicMount svg").waitFor();
  await page.locator("#rightSchematicMount svg").waitFor();
  await page.locator("#libertyInput").setInputFiles(file("other.lib", liberty.replace("demo", "other")));
  await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded Liberty other.lib"));
  await page.locator("#clearLibertyButton").evaluate((button) => button.click());
  await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Liberty unloaded"));
  assert.match(await page.locator("#libertySummary").innerText(), /No library/);
  await page.locator("#exitCompareButton").evaluate((button) => button.click());
  await page.locator("#schematicMount svg").waitFor();
  // The complete JSON extends beyond the sniffing prefix and must be applied
  // after the design even though the user dropped it first.
  await page.evaluate(({ source, liberty }) => {
    const transfer = new DataTransfer();
    const timing = JSON.stringify({ metadata: { padding: "x".repeat(70000), note: "netlist-layout-golden" },
      module: "top", points: { "u/RESULT": [0.75, 0.5, -0.25] } });
    transfer.items.add(new File([timing], "drop_timing.json", { type: "application/json" }));
    transfer.items.add(new File([source], "drop.v", { type: "text/plain" }));
    transfer.items.add(new File([liberty], "drop.lib", { type: "text/plain" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, { source, liberty });
  await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded timing drop_timing.json"));
  assert.match(await page.locator("#libertySummary").innerText(), /drop.lib/);
  await page.locator('#schematicMount [data-node-id="cell:u"]').first().click({ force: true });
  assert.match(await page.locator("#selectionDetails").innerText(), /-0\.25/);
  // Exercise the actual Cancel button while a File import is being scanned.
  const buttonCancelMs = await page.evaluate(async () => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["/*", "x".repeat(32 * 1024 * 1024), "*/library(unwanted){}"], "cancel.lib"));
    const input = document.querySelector("#libertyInput");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const deadline = performance.now() + 5000;
    while (document.querySelector("#cancelLibertyButton").disabled) {
      if (performance.now() > deadline) throw new Error("Cancel never became available");
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const started = performance.now();
    document.querySelector("#cancelLibertyButton").click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return performance.now() - started;
  });
  assert.ok(buttonCancelMs < 500);
  assert.match(await page.locator("#libertySummary").innerText(), /drop.lib/);
  assert.match(await page.locator("#statusBar").innerText(), /cancelled/);
  // Hold the actual File read before it reaches the library controller, then unload.
  await page.evaluate(() => {
    const originalText = File.prototype.text;
    const file = new File(["library(stale){}"], "stale.lib");
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    File.prototype.text = function () {
      if (this.name !== "stale.lib") return originalText.call(this);
      File.prototype.text = originalText;
      window.finishLibertyRead = release;
      return pending;
    };
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector("#libertyInput");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => typeof window.finishLibertyRead === "function");
  await page.locator("#clearLibertyButton").evaluate((button) => button.click());
  await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Liberty unloaded"));
  await page.evaluate(async () => {
    window.finishLibertyRead("library(stale){}");
    delete window.finishLibertyRead;
    // Let the read's await continuation and cooperative parser checkpoints drain.
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  assert.match(await page.locator("#libertySummary").innerText(), /No library/);
  assert.match(await page.locator("#statusBar").innerText(), /Liberty unloaded/);
  await page.locator("#libertyInput").setInputFiles(file("fresh.lib", liberty));
  await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded Liberty fresh.lib"));
  await mkdir(new URL("../../dc_runs/liberty/", import.meta.url), { recursive: true });
  await page.locator("#libertySummary").scrollIntoViewIfNeeded();
  await page.screenshot({ path: fileURLToPath(new URL("../../dc_runs/liberty/browser.png", import.meta.url)) });
  const cancelMs = await page.evaluate(async () => {
    const { createLibertyLibraryService } = await import("/src/domains/netlist/liberty_import.js");
    const { runCooperativeTask } = await import("/src/application/cooperative_task.js");
    const service = createLibertyLibraryService({ execute: runCooperativeTask });
    const text = "/*" + "x".repeat(16 * 1024 * 1024) + "*/library(x){}";
    const started = performance.now();
    const pending = service.importText(text);
    setTimeout(service.cancel, 20);
    try { await pending; throw new Error("Cancellation did not happen"); }
    catch (error) { if (error.name !== "AbortError") throw error; }
    return performance.now() - started;
  });
  assert.ok(cancelMs < 500, `Cancellation took ${cancelMs}ms`);
  assert.deepEqual(errors, []);
  return { workflow: "liberty-import-details-failure-compare-unload-drop-timing-json-cancel", buttonCancelMs, cancelMs, errors };
}, { root, chromium, executablePath: process.env.NGB_CHROME });
console.log(JSON.stringify({ ...report, cleanup: "passed" }));
