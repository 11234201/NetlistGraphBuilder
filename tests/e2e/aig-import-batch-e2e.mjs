import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const artifacts = resolve(process.env.NGB_AIG_BATCH_ARTIFACT_DIR || join(root, "dc_runs", `aig-import-batch-${Date.now()}`));
const blif = await readFile(join(root, "tests/fixtures/aig/shared_cone.blif"), "utf8");
const netlist = "module top(input a, output y); SPECIAL u(.A(a),.Y(y)); endmodule";
const liberty = 'library(mixed){cell(SPECIAL){pin(A){direction:input;}pin(Y){direction:output;function:"!A";}}}';
const file = (name, text) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
const report = { cases: [], errors: [], externalRequests: [] };
let currentCase;
await mkdir(artifacts, { recursive: true });

async function loadAig(page, name) {
  await page.locator("#aigFileInput").setInputFiles(file(name, blif));
  await page.waitForFunction((name) => document.querySelector("#statusBar").textContent.includes(`Loaded ${name}`), name);
  await page.locator("#schematicMount [data-aig-node]").first().waitFor();
}

async function dropBatch(page, source = netlist, name = "mixed.v") {
  await page.evaluate(({ source, name, liberty }) => {
    const transfer = new DataTransfer();
    // Library first reproduces the original loss of a batch attachment while
    // the current domain still rejects Netlist-only imports.
    transfer.items.add(new File([liberty], "mixed.lib", { type: "text/plain" }));
    transfer.items.add(new File([source], name, { type: "text/plain" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, { source, name, liberty });
}

async function snapshot(page) {
  return page.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem("ngb.domain-workspace.v1"));
    // Viewport can change while the shell settles; document and policy cannot.
    const { viewport, ...documentState } = saved || {};
    return { documentState, library: document.querySelector("#libertySummary").textContent,
      objects: [...document.querySelectorAll("#schematicMount [data-aig-object]")].map((node) => node.dataset.aigObject) };
  });
}

try {
  await runBrowserTest(async ({ browser, url }) => {
    async function check(name, run) {
      currentCase = name;
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      await context.route("**/*", async (route) => {
        const requested = new URL(route.request().url());
        if (["http:", "https:"].includes(requested.protocol) && requested.origin !== new URL(url).origin) {
          report.externalRequests.push(requested.href);
          await route.abort();
        } else await route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => report.errors.push({ case: name, message: error.message }));
      try {
        await page.goto(url);
        await page.locator("#schematicMount svg").waitFor();
        await loadAig(page, "original.blif");
        await run(page);
        report.cases.push({ name, status: "passed" });
      } catch (error) {
        await page.screenshot({ path: join(artifacts, `${name}-failure.png`) }).catch(() => {});
        throw error;
      } finally { await context.close(); }
    }

    await check("aig-to-netlist-keeps-batch-library", async (page) => {
      await dropBatch(page);
      await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded Liberty mixed.lib"));
      assert.equal(await page.locator("#domainToolbar").isVisible(), false);
      assert.match(await page.locator("#libertySummary").textContent(), /mixed\.lib.*1 cells/);
      assert.equal(await page.evaluate(() => sessionStorage.getItem("ngb.domain-workspace.v1")), null);
      await page.locator('#schematicMount [data-node-id="cell:u"] .node-shape').first().click();
      assert.match(await page.locator("#selectionDetails").innerText(), /mixed\.lib/,
        "the loaded library must actually refresh the new Netlist's cell inference");
    });

    await check("invalid-batch-netlist-retains-aig", async (page) => {
      const before = await snapshot(page);
      await dropBatch(page, "this is not Verilog", "broken.v");
      // The failed design leaves AIG active, which still rejects its attachment.
      await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Open a netlist first"));
      assert.equal(await page.locator("#domainToolbar").isVisible(), true);
      assert.deepEqual(await snapshot(page), before);
    });

    await check("new-aig-cancels-pending-netlist-batch", async (page) => {
      await page.evaluate(() => {
        const original = File.prototype.text;
        window.__batchRead = { started: false, finished: false };
        File.prototype.text = async function (...args) {
          const source = await original.apply(this, args);
          if (this.name === "held.v") {
            await new Promise((resolve) => {
              window.__batchRead.release = resolve;
              window.__batchRead.started = true;
            });
            window.__batchRead.finished = true;
          }
          return source;
        };
      });
      await dropBatch(page, netlist, "held.v");
      await page.waitForFunction(() => window.__batchRead.started);
      await loadAig(page, "replacement.blif");
      const replacement = await snapshot(page);
      await page.evaluate(() => window.__batchRead.release());
      await page.waitForFunction(() => window.__batchRead.finished);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator("#domainToolbar").isVisible(), true);
      assert.deepEqual(await snapshot(page), replacement);
      assert.match(await page.locator("#statusBar").textContent(), /Loaded replacement\.blif/);
    });

    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.externalRequests, []);
  }, { root, chromium, executablePath: process.env.NGB_CHROME });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = { case: currentCase, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await writeFile(join(artifacts, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, failure: report.failure, artifacts }));
}
