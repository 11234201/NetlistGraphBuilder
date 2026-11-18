import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";
import { importAigSource } from "../../src/domains/aig/aig_import.js";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const artifacts = join(root, "dc_runs/aig_paste_dialog");
await mkdir(artifacts, { recursive: true });
const text = await readFile(new URL("../fixtures/aig/shared_cone.blif", import.meta.url), "utf8");
const { model } = importAigSource(text, { name: "paste.blif" });
const cases = [];

await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__pasteTest = { mode: "normal", calls: 0, terminated: 0 };
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, { construct(target, args) {
      const worker = Reflect.construct(target, args);
      if (String(args[0]).includes("graphviz_worker.js")) {
        const send = worker.postMessage.bind(worker), terminate = worker.terminate.bind(worker);
        worker.terminate = () => { window.__pasteTest.terminated++; return terminate(); };
        worker.postMessage = (...values) => {
          window.__pasteTest.calls++;
          if (window.__pasteTest.mode === "timeout") throw Object.assign(new Error("Graphviz exceeded 20000 ms"), { name: "TimeoutError" });
          if (window.__pasteTest.mode === "hold") return;
          return send(...values);
        };
      }
      return worker;
    } });
  });
  const form = page.locator("#netlistTextForm");
  const dialog = page.locator("#netlistTextDialog");
  const input = page.locator("#netlistTextInput");
  const view = form.locator("[data-aig-input-view]");
  const submit = form.locator("[data-text-submit]");
  const status = form.locator("[data-text-status]");
  const open = () => page.evaluate(() => document.querySelector("#pasteAigButton").click());
  try {
    await page.goto(url);
    await page.locator("#aigFileInput").setInputFiles({ name: "old.blif", mimeType: "text/plain", buffer: Buffer.from(text) });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded old.blif"));
    await page.evaluate(() => { window.__oldSvg = document.querySelector("#schematicMount svg"); });

    await open();
    assert.equal(await view.inputValue(), "abc");
    await input.fill(text);
    await page.evaluate(() => { window.__pasteTest.mode = "hold"; });
    const before = await page.evaluate(() => ({ ...window.__pasteTest }));
    await submit.click();
    await page.waitForFunction((count) => window.__pasteTest.calls > count, before.calls);
    assert.equal(await submit.isDisabled(), true);
    assert.equal(await input.isDisabled(), true);
    assert.equal(await view.isDisabled(), true);
    assert.equal(await status.isVisible(), true);
    assert.match(await status.textContent(), /正在解析并布局/);
    await form.evaluate((element) => element.requestSubmit());
    assert.equal(await page.evaluate(() => window.__pasteTest.calls), before.calls + 1);
    await page.locator("#cancelNetlistTextButton").click();
    assert.equal(await dialog.isVisible(), false);
    assert.ok(await page.evaluate((count) => window.__pasteTest.terminated > count, before.terminated));
    assert.equal(await page.evaluate(() => window.__oldSvg === document.querySelector("#schematicMount svg")), true);
    cases.push("busy feedback prevents duplicate work; Cancel terminates the worker and preserves the old view");

    await open();
    assert.equal(await input.inputValue(), text);
    await view.selectOption("standard");
    await page.evaluate(() => { window.__pasteTest.mode = "timeout"; });
    await submit.click();
    await page.waitForFunction(() => document.querySelector("[data-text-status]").textContent.includes("Graphviz exceeded"));
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await status.isVisible(), true);
    assert.match(await status.textContent(), /Logic View/);
    assert.equal(await submit.isEnabled(), true);
    assert.equal(await view.isEnabled(), true);
    assert.equal(await input.inputValue(), text);
    assert.equal(await page.evaluate(() => window.__oldSvg === document.querySelector("#schematicMount svg")), true);
    const box = await status.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= 1000, "timeout guidance must be visible inside the modal");
    await page.screenshot({ path: join(artifacts, "timeout.png") });
    cases.push("timeout appears inside the modal with a Logic View retry hint and retains the source");

    await view.selectOption("abc");
    await page.evaluate(() => { window.__pasteTest.mode = "normal"; });
    await submit.click();
    await page.waitForFunction(() => !document.querySelector("#netlistTextDialog").open);
    assert.equal(await page.locator('[data-domain-policy="viewStyle"]').inputValue(), "abc");
    assert.equal(await page.locator("#schematicMount [data-aig-node]").count(), model.nodes.length);
    assert.equal(await page.locator("#schematicMount [data-aig-edge]").count(), model.edges.length);
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem("ngb.domain-workspace.v1"))?.presentationPolicy?.viewStyle === "abc");
    await page.screenshot({ path: join(artifacts, "abc.png") });
    cases.push("Logic View retry completes through real Graphviz, preserves every object and saves the selected view");

    await open();
    await page.evaluate(() => { window.__pasteTest.mode = "hold"; });
    const previousCalls = await page.evaluate(() => window.__pasteTest.calls);
    await submit.click();
    await page.waitForFunction((count) => window.__pasteTest.calls > count, previousCalls);
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), false);
    await open();
    assert.equal(await submit.isEnabled(), true);
    assert.equal(await input.isEnabled(), true);
    assert.equal(await status.isVisible(), false);
    await page.locator("#closeNetlistTextButton").click();
    cases.push("Escape cancels a pending layout and the next dialog opens ready for retry");
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, "report.json"), JSON.stringify({ cases, errors }, null, 2));
    console.log(JSON.stringify({ cases, errors, artifacts }));
  } catch (error) {
    await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
    throw error;
  }
}, { root, chromium, executablePath: process.env.NGB_CHROME });
