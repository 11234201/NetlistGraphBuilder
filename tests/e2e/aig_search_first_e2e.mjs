import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const sample = fileURLToPath(new URL("../../examples/aig_mapped_names.blif", import.meta.url));

await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.graphvizCalls = [];
    window.Worker = new Proxy(window.Worker, { construct(target, args) {
      const worker = Reflect.construct(target, args);
      if (String(args[0]).includes("graphviz_worker.js")) {
        const send = worker.postMessage.bind(worker);
        worker.postMessage = (message) => {
          window.graphvizCalls.push(message.dot);
          if (window.failLayout) throw Object.assign(new Error("injected Whole layout timeout"), { name: "TimeoutError" });
          send(message);
        };
      }
      return worker;
    } });
  });
  const calls = () => page.evaluate(() => window.graphvizCalls.length);
  const idle = () => page.waitForFunction(() => document.querySelector("#cancelDomainImportButton").hidden);
  const indexed = page.locator("#schematicMount .search-first-empty");
  const action = (name) => page.locator(`#showPathMenu [data-path-action="${name}"]`);
  try {
    await page.goto(url);
    await page.locator("#fileMenu > summary").click();
    await page.locator("#aigSearchFirstInput").check();
    await page.locator("#aigFileInput").setInputFiles(sample);
    await indexed.waitFor(); await idle();
    assert.equal(await calls(), 0);
    assert.equal(await page.locator("#exportSvgButton").isDisabled(), true);
    await page.reload(); await indexed.waitFor();
    assert.equal(await calls(), 0, "restoring the indexed workspace skips Graphviz");

    await page.evaluate(() => { window.failLayout = true; });
    await page.locator("#wholeViewButton").click();
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("injected Whole layout timeout"));
    assert.ok(await indexed.isVisible());
    const download = page.waitForEvent("download");
    await page.locator("#exportProcessLogButton").evaluate((el) => el.click());
    const entries = (await readFile(await (await download).path(), "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    const failures = entries.filter((r) => r.details?.operation === "aig.whole.layout" && r.level === "error");
    assert.equal(failures.length, 1);
    assert.equal(failures[0].details.error.name, "TimeoutError");
    assert.equal(failures[0].details.previousScope, "search-first");
    assert.ok(failures[0].details.jobId && failures[0].details.error.stack);
    await page.evaluate(() => { window.failLayout = false; });
    await page.locator("#searchInput").fill("in_96");
    await page.locator("#searchResults .search-result-main").first().click();
    await page.locator("#focusedViewButton.is-active").waitFor(); await idle();
    assert.equal(await calls(), 2);
    assert.ok((await page.locator("#schematicMount .aig-node-label").allTextContents()).includes("n0"));
    await page.locator("#clearFocusedRootsButton").evaluate((el) => el.click());
    await indexed.waitFor(); await idle();
    assert.equal(await calls(), 2, "clearing roots does not request Whole");

    await page.locator("#showPathMenu > summary").click();
    for (const [term, match, role] of [["in_96", /· pi/, "starts"], ["4388notBoutput", /· po/, "ends"]]) {
      await page.locator("#pathFind").fill(term);
      await page.locator("#pathCandidates .path-row").filter({ hasText: match }).first().locator(`[data-path-action="${role}"]`).click();
    }
    await action("apply").click(); await page.locator("#showPathMenu[data-enabled]").waitFor(); await idle();
    assert.match(await page.locator("#pathReportBody").innerText(), /To selected end 1 · From start 0/);
    const labels = await page.locator("#schematicMount .aig-node-label").allTextContents();
    assert.ok(labels.includes("n0") && labels.includes("n3") && !labels.includes("n4"));
    assert.ok(labels.every((label) => !label.includes("combined/") && !label.includes("4388notBoutput")));
    assert.equal(await calls(), 3);
    await action("clear").click(); await indexed.waitFor(); await idle();
    assert.equal(await calls(), 3, "clearing a path returns directly to the index");
    await page.keyboard.press("Escape");
    await page.locator("#wholeViewButton").click(); await page.locator("#schematicMount [data-aig-node]").first().waitFor(); await idle();
    assert.equal(await calls(), 4);
    assert.deepEqual(errors, []);
    console.log("Search-first skipped Graphviz at import and restore, recovered from timeout, and laid out only the requested scopes.");
  } finally { await page.close(); }
}, { root, chromium, executablePath: process.env.NGB_CHROME });
