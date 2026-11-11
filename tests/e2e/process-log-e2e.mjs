import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";
const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");

const report = await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator("#schematicMount svg").waitFor();
  assert.deepEqual(errors, []);
  const waitForLog = (text) => page.waitForFunction((text) => document.querySelector("#processLogList").textContent.includes(text), text);
  await page.locator("#libertyInput").setInputFiles({ name: "broken.lib", mimeType: "text/plain", buffer: Buffer.from("invalid liberty") });
  await waitForLog("Liberty import failed");
  assert.equal(await page.locator("#toggleProcessLogButton").getAttribute("aria-expanded"), "true");
  await page.evaluate(() => {
    setTimeout(() => {
      const error = new Error("injected runtime failure");
      error.diagnostic = { phase: "test", invariant: "diagnostic-preserved", nested: { accessToken: "must-not-export" } };
      throw error;
    }, 0);
  });
  await waitForLog("injected runtime failure");
  await page.evaluate(() => { void Promise.reject(new Error("injected rejection")); });
  await waitForLog("injected rejection");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.restoreTestStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key, value) {
      if (key === "netlistGraphBuilder.session.v2") throw new Error("injected storage failure");
      return original.call(this, key, value);
    };
    const select = document.querySelector("#gateSymbolModeSelect");
    select.value = select.value === "rectangle" ? "conventional" : "rectangle";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitForLog("Session could not be saved");
  await page.evaluate(() => { window.restoreTestStorage(); delete window.restoreTestStorage; });
  await page.locator("#processLogPhaseFilter").selectOption("persistence");
  const persistence = await page.locator("#processLogList").textContent();
  assert.match(persistence, /Session could not be saved/);
  assert.doesNotMatch(persistence, /injected runtime failure/);
  await page.locator("#processLogPhaseFilter").selectOption("runtime");
  assert.match(await page.locator("#processLogList").textContent(), /injected rejection/);
  await page.locator("#processLogPhaseFilter").selectOption("");
  const downloaded = page.waitForEvent("download");
  await page.locator("#exportProcessLogButton").click();
  const download = await downloaded;
  assert.equal(download.suggestedFilename(), "netlist-process-log.jsonl");
  let text = "";
  for await (const chunk of await download.createReadStream()) text += chunk.toString("utf8");
  const entries = text.trim().split("\n").map((line) => JSON.parse(line));
  const runtime = entries.find((entry) => entry.message.includes("injected runtime failure"));
  assert.equal(runtime.phase, "runtime");
  assert.match(runtime.details.error.stack, /injected runtime failure/);
  assert.equal(runtime.details.error.diagnostic.invariant, "diagnostic-preserved");
  assert.doesNotMatch(text, /must-not-export/);
  assert.ok(entries.some((entry) => entry.phase === "persistence"));
  assert.ok(entries.some((entry) => entry.message.startsWith("Liberty import failed") && entry.details.error.stack));
  assert.deepEqual(errors.sort(), ["injected rejection", "injected runtime failure"].sort());
  await page.locator("#clearProcessLogButton").click();
  assert.equal(await page.locator("#processLogCount").textContent(), "0");
  return { workflow: "failure-global-errors-diagnostics-persistence-filter-jsonl", expectedPageErrors: errors, entries: entries.length };
}, {
  root: fileURLToPath(new URL("../..", import.meta.url)), chromium, executablePath: process.env.NGB_CHROME,
  ...(process.env.NGB_RELEASE_EXE ? { createServer: () => spawn(process.env.NGB_RELEASE_EXE,
    ["--no-browser", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }) } : {})
});
console.log(JSON.stringify({ ...report, cleanup: "passed" }));
