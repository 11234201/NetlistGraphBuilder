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
  await page.addInitScript(() => {
    sessionStorage.setItem("netlistGraphBuilder.session.v2", '{"version":99}');
    localStorage.setItem("netlistGraphBuilder.cellConfig.v1", '{"version":99}');
  });
  await page.goto(url);
  await page.locator("#schematicMount svg").waitFor();
  assert.deepEqual(errors, []);
  const waitForLog = async (text) => {
    try {
      await page.waitForFunction((text) => document.querySelector("#processLogList").textContent.includes(text), text);
    } catch (error) {
      throw new Error(`Expected log: ${text}\n${await page.locator("#processLogList").textContent()}`, { cause: error });
    }
  };
  await waitForLog("Stored session could not be restored");
  await waitForLog("Stored Cell Config could not be loaded");
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
  await page.evaluate(() => {
    window.restoreTestStorage();
    delete window.restoreTestStorage;
    const select = document.querySelector("#gateSymbolModeSelect");
    select.value = select.value === "rectangle" ? "conventional" : "rectangle";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitForLog("Session saving recovered");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.restoreTestStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key, value) {
      if (key === "netlistGraphBuilder.cellConfig.v1") throw new DOMException("config storage full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  const configFile = { name: "cells.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
    kind: "netlist-cell-config", version: 1, cells: { TEST: { gateKind: "BUF", pins: { A: "input", Y: "output" } } }
  })) };
  await page.locator("#cellConfigInput").setInputFiles(configFile);
  await waitForLog("Cell Config change could not be saved");
  assert.equal(await page.locator("#exportCellConfigButton").isDisabled(), true);
  await page.evaluate(() => { window.restoreTestStorage(); delete window.restoreTestStorage; });
  const completedLayouts = (await page.locator("#processLogList").textContent()).match(/Layout completed:/g)?.length || 0;
  await page.locator("#cellConfigInput").setInputFiles(configFile);
  await waitForLog("Imported Cell Config cells.json");
  await page.waitForFunction((previous) =>
    (document.querySelector("#processLogList").textContent.match(/Layout completed:/g)?.length || 0) > previous, completedLayouts);
  await page.waitForFunction(() => !document.querySelector("#exportSvgButton").disabled);
  await page.evaluate(() => {
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() { throw new Error("injected download failure"); };
    try {
      for (const id of ["exportSvgButton", "saveGoldenButton", "exportCellConfigButton"]) document.getElementById(id).click();
    } finally { HTMLAnchorElement.prototype.click = original; }
  });
  for (const label of ["SVG", "Layout Golden", "Cell Config"]) await waitForLog(`${label} export failed`);
  await page.locator("#processLogPhaseFilter").selectOption("persistence");
  const persistence = await page.locator("#processLogList").textContent();
  assert.match(persistence, /Session could not be saved/);
  assert.doesNotMatch(persistence, /injected runtime failure/);
  await page.locator("#processLogPhaseFilter").selectOption("runtime");
  assert.match(await page.locator("#processLogList").textContent(), /injected rejection/);
  const upload = (selector, name, content) => page.locator(selector).setInputFiles({
    name, mimeType: "text/plain", buffer: Buffer.from(content)
  });
  await upload("#fileInput", "single-round.v", `
    module LocalDesign_1of1(input a, output y);
      wire n; reg skipped; (* keep *) BUF u_seen (.A(a), .Z(n)); BUF u_missing (.A(n), .Z(y));
    endmodule
    module Peer(input a, output y); BUF u_peer (.A(a), .Z(y)); endmodule`);
  await page.locator('#schematicMount [data-node-id="cell:u_seen"]').first().waitFor();
  await page.locator("#processLogPhaseFilter").selectOption("parse");
  const partialRow = page.locator("#processLogList li").filter({ hasText: "Parsed 2 module(s)" }).last();
  await partialRow.locator("summary").click();
  const partial = JSON.parse(await partialRow.locator("details[open] pre").innerText());
  assert.equal(partial.code, "netlist.parsed-with-warnings");
  assert.equal(partial.fileName, "single-round.v");
  assert.equal(partial.diagnosticExamples[0].code, "unsupported-declaration");
  assert.equal(partial.diagnosticExamples[0].moduleName, "LocalDesign_1of1");
  await page.locator("#processLogPhaseFilter").selectOption("timing");
  await upload("#timingInput", "single-round.txt",
    "@module LocalDesign_1of1\npoint at rt slack\nu_seen/Z 2 1 -1\nu_typo/Z 2 1 -1\nu_missing/Z invalid-private-value 1 -1");
  await waitForLog("LocalDesign_1of1, 1/2 cells annotated");
  const matchEntry = page.locator("#processLogList li").filter({ hasText: "LocalDesign_1of1, 1/2 cells annotated" }).last();
  await matchEntry.locator("summary").click();
  const displayedTiming = JSON.parse(await matchEntry.locator("details[open] pre").innerText());
  assert.equal(displayedTiming.sessionId, "single");
  assert.equal(displayedTiming.unmatchedExamples[0].line, 4);
  assert.deepEqual(displayedTiming.cellsWithoutTiming, ["u_missing"]);
  const inspectMissing = async (mount) => {
    await page.locator(`${mount} [data-node-id="cell:u_missing"] .node-shape`).first().click();
    await page.locator('[data-inspector-tab="timing"]').click();
    const panel = page.locator('[data-inspector-section="timing"]');
    assert.match(await panel.innerText(), /parse-invalid-number/);
    assert.match(await panel.innerText(), /single-round\.txt/);
    await panel.locator("[data-log-cell-timing]").click();
  };
  await inspectMissing("#schematicMount");
  await page.locator("#compareButton").click();
  await waitForLog("left / LocalDesign_1of1, 1/2 cells annotated");
  await waitForLog("right / Peer, 0/1 cells annotated");
  await inspectMissing("#leftSchematicMount");
  await upload("#compareRightTimingInput", "right.txt", "@module Peer\npoint at rt slack\nu_peer/Z 2 1 -1");
  await waitForLog("right / Peer, 1/1 cells annotated");
  await upload("#compareRightTimingInput", "invalid-right.txt", "@module Peer\npoint at rt slack\nu_peer/Z private-invalid 1 -1");
  await waitForLog("Timing parse failed");
  const priorBadge = await page.locator("#rightSchematicMount .timing-badge").first().textContent();
  await upload("#compareRightTimingInput", "broken.json", '# header\n{"points":}');
  const malformed = page.locator("#processLogList li").filter({ hasText: "Timing parse failed" }).last();
  await page.waitForFunction(() => [...document.querySelectorAll("#processLogList li pre")]
    .some((pre) => pre.textContent.includes("broken.json") && pre.textContent.includes("invalid-json")));
  await malformed.locator("summary").click();
  const displayedJson = JSON.parse(await malformed.locator("details[open] pre").innerText());
  assert.equal(displayedJson.fileName, "broken.json");
  assert.equal(displayedJson.error.cause.name, "SyntaxError");
  assert.equal(displayedJson.error.diagnostic.diagnosticExamples[0].line, 2);
  assert.equal(await page.locator("#rightSchematicMount .timing-badge").first().textContent(), priorBadge);
  await page.locator("#processLogPhaseFilter").selectOption("");
  const downloaded = page.waitForEvent("download");
  await page.locator("#exportProcessLogButton").click();
  const download = await downloaded;
  assert.equal(download.suggestedFilename(), "netlist-process-log.jsonl");
  let text = "";
  for await (const chunk of await download.createReadStream()) text += chunk.toString("utf8");
  const entries = text.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(entries.find((row) => row.details?.code === "netlist.parsed-with-warnings" &&
    row.details.fileName === "single-round.v").details, partial);
  assert.deepEqual(entries.find((row) => row.details?.code === "timing.parse-failed" &&
    row.details.fileName === "broken.json").details, displayedJson);
  const timingMatches = entries.filter((entry) => entry.details?.operation === "timing.match");
  const inspected = entries.filter((entry) => entry.details?.operation === "timing.inspect-cell");
  assert.deepEqual(inspected.map((entry) => [entry.details.side, entry.details.evidence["parse-invalid-number"].line]),
    [[null, 5], ["left", 5]]);
  assert.deepEqual(timingMatches.find((entry) => entry.details.moduleName === "LocalDesign_1of1" && entry.details.sessionId === "single").details,
    displayedTiming);
  assert.equal(timingMatches.filter((entry) => entry.details.moduleName === "LocalDesign_1of1" && entry.details.side === "left").length, 1);
  const peer = timingMatches.filter((entry) => entry.details.side === "right" && entry.details.moduleName === "Peer");
  assert.deepEqual(peer.map((entry) => entry.details.code), ["timing.no-applicable-records", "timing.matched"]);
  const parseWarning = entries.find((entry) => entry.details?.code === "timing.parsed-with-warnings" && entry.details.fileName === "single-round.txt");
  assert.equal(parseWarning.details.diagnosticExamples[0].line, 5);
  const failedImport = entries.filter((entry) => entry.level === "error" && entry.details?.fileName === "invalid-right.txt");
  assert.equal(failedImport.length, 1);
  assert.equal(failedImport[0].details.compareSide, "right");
  assert.equal(failedImport[0].details.error.diagnostic.diagnosticExamples[0].line, 3);
  assert.ok(failedImport[0].details.error.stack);
  assert.doesNotMatch(text, /invalid-private-value|private-invalid/);
  const runtime = entries.find((entry) => entry.message.includes("injected runtime failure"));
  assert.equal(runtime.phase, "runtime");
  assert.match(runtime.details.error.stack, /injected runtime failure/);
  assert.equal(runtime.details.error.diagnostic.invariant, "diagnostic-preserved");
  assert.doesNotMatch(text, /must-not-export/);
  const saveFailure = entries.find((entry) => entry.details?.operation === "save-session" && entry.level === "error");
  assert.match(saveFailure.details.error.stack, /injected storage failure/);
  for (const operation of ["load-session", "load-cell-config"]) {
    const entry = entries.find((entry) => entry.details?.operation === operation && entry.level === "error");
    assert.equal(entry.phase, "persistence");
    assert.ok(entry.details.error.stack);
  }
  const configFailure = entries.find((entry) => entry.details?.operation === "import-cell-config" && entry.level === "error");
  assert.equal(configFailure.phase, "persistence");
  assert.equal(configFailure.details.error.name, "QuotaExceededError");
  assert.equal(configFailure.details.error.code, 22);
  assert.equal(configFailure.details.error.message, "config storage full");
  for (const operation of ["export-svg", "export-golden", "export-cell-config"]) {
    const entry = entries.find((entry) => entry.details?.operation === operation && entry.level === "error");
    assert.equal(entry.phase, "export");
    assert.match(entry.details.error.stack, /injected download failure/);
    assert.ok(entry.details.fileName);
  }
  assert.ok(entries.some((entry) => entry.message.startsWith("Liberty import failed") && entry.details.error.stack));
  assert.deepEqual(errors.sort(), ["injected rejection", "injected runtime failure"].sort());
  const workerPage = await browser.newPage();
  await workerPage.route("**/native_layout_worker.js", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace("import { layoutGraph } from \"./anchor_layered/index.js\";",
      `function layoutGraph() { throw Object.assign(new Error("native fixture failed", {
        cause: new TypeError("worker fixture cause") }), { code: 42 }); }`);
    await route.fulfill({ response, body });
  });
  await workerPage.goto(url);
  const workerRow = workerPage.locator("#processLogList li").filter({ hasText: "native fixture failed" }).first();
  await workerRow.locator("summary").click();
  const failure = JSON.parse(await workerRow.locator("details[open] pre").innerText());
  assert.equal(failure.operation, "layout.provider");
  assert.equal(failure.code, "layout.provider-failed");
  assert.equal(failure.error.code, 42);
  assert.match(failure.error.cause.stack, /native_layout_worker/);
  const workerDownload = workerPage.waitForEvent("download");
  await workerPage.locator("#exportProcessLogButton").click();
  let workerJsonl = "";
  for await (const chunk of await (await workerDownload).createReadStream()) workerJsonl += chunk.toString("utf8");
  assert.deepEqual(workerJsonl.trim().split("\n").map(JSON.parse)
    .filter((entry) => entry.details?.operation === "layout.provider").map((entry) => entry.details), [failure]);
  await workerPage.close();
  await page.locator("#clearProcessLogButton").click();
  assert.equal(await page.locator("#processLogCount").textContent(), "0");
  return { workflow: "restore-storage-recovery-config-export-global-errors-filter-jsonl", expectedPageErrors: errors, entries: entries.length };
}, {
  root: fileURLToPath(new URL("../..", import.meta.url)), chromium, executablePath: process.env.NGB_CHROME,
  ...(process.env.NGB_RELEASE_EXE ? { createServer: () => spawn(process.env.NGB_RELEASE_EXE,
    ["--no-browser", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }) } : {})
});
console.log(JSON.stringify({ ...report, cleanup: "passed" }));
