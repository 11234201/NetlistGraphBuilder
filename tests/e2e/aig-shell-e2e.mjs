import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const artifacts = resolve(process.env.NGB_AIG_SHELL_ARTIFACT_DIR || join(root, "dc_runs", `aig-shell-${Date.now()}`));
const blif = await readFile(join(root, "tests/fixtures/aig/shared_cone.blif"), "utf8");
const warningNetlist = "module warning(output y); wire missing; BUF u(.A(missing),.Y(y)); endmodule";
const file = (name, source) => ({ name, mimeType: "text/plain", buffer: Buffer.from(source) });
const report = { cases: [], errors: [], externalRequests: [] };
let currentCase;
await mkdir(artifacts, { recursive: true });

try {
  await runBrowserTest(async ({ browser, url }) => {
    for (const mode of ["open", "closed", "open-with-log"]) {
      currentCase = `diagnostics-domain-isolation-${mode}`;
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      await context.route("**/*", async (route) => {
        const requested = new URL(route.request().url());
        if (["http:", "https:"].includes(requested.protocol) && requested.origin !== new URL(url).origin) {
          report.externalRequests.push(requested.href); await route.abort();
        } else await route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => report.errors.push({ case: currentCase, message: error.message }));
      try {
        await page.goto(url);
        await page.locator("#schematicMount svg").waitFor();
        await page.locator("#fileInput").setInputFiles(file("warning.v", warningNetlist));
        await page.waitForFunction(() => document.querySelector("#diagnosticsList").textContent.includes("no explicit driver"));
        if (mode !== "closed") await page.locator("#toggleDiagnosticsButton").click();
        assert.equal(await page.locator("#diagnosticsDrawer").isVisible(), mode !== "closed");
        await page.locator("#aigFileInput").setInputFiles(file("clean.blif", blif));
        await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded clean.blif"));
        assert.equal(await page.locator("#diagnosticsDrawer").isVisible(), false, "AIG must not show Netlist diagnostics");
        assert.equal(await page.locator("#toggleDiagnosticsButton").isVisible(), false);
        assert.equal(await page.locator("#sourceBadge").textContent(), "clean.blif");
        if (mode === "open-with-log") {
          await page.locator("#toggleProcessLogButton").click();
          await page.locator("#closeProcessLogButton").click();
          assert.equal(await page.locator("#diagnosticsDrawer").isVisible(), false);
        }
        // A second AIG commit must preserve the original Netlist visibility.
        await page.locator("#aigFileInput").setInputFiles(file("replacement.blif", blif));
        await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded replacement.blif"));
        assert.equal(await page.locator("#diagnosticsDrawer").isVisible(), false);
        await page.locator("#fileInput").setInputFiles(file("return.v", warningNetlist));
        await page.waitForFunction(() => document.querySelector("#sourceBadge").textContent === "return.v"
          && document.querySelector("#diagnosticsList").textContent.includes("no explicit driver")
          && document.querySelector("#diagnosticsCount").textContent === "1");
        assert.equal(await page.locator("#toggleDiagnosticsButton").isVisible(), true);
        assert.equal(await page.locator("#diagnosticsDrawer").isVisible(), mode !== "closed");
        assert.equal(await page.locator("#toggleDiagnosticsButton").getAttribute("aria-expanded"), String(mode !== "closed"));
        assert.equal(await page.locator("#diagnosticsCount").textContent(), "1");
        assert.match(await page.locator("#diagnosticsList").textContent(), /Net missing has no explicit driver/);
        report.cases.push({ name: currentCase, status: "passed" });
      } catch (error) {
        await page.screenshot({ path: join(artifacts, `${currentCase}-failure.png`) }).catch(() => {});
        throw error;
      } finally { await context.close(); }
    }
    for (const outcome of ["success", "failure", "conflict"]) {
      currentCase = `late-cell-config-${outcome}`;
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      await context.route("**/*", async (route) => {
        const requested = new URL(route.request().url());
        if (["http:", "https:"].includes(requested.protocol) && requested.origin !== new URL(url).origin) {
          report.externalRequests.push(requested.href); await route.abort();
        } else await route.continue();
      });
      const configuration = { kind: "netlist-cell-config", version: 1,
        cells: { PROBE: { gateKind: "BUF", pins: { A: "input", Z: "output" } } } };
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => report.errors.push({ case: currentCase, message: error.message }));
      const dialogs = [];
      page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
      if (outcome === "conflict") await page.addInitScript((configuration) => {
        localStorage.setItem("netlistGraphBuilder.cellConfig.v1", JSON.stringify(configuration));
      }, configuration);
      try {
        await page.goto(url);
        await page.locator("#schematicMount svg").waitFor();
        await page.evaluate((outcome) => {
          const original = File.prototype.text;
          File.prototype.text = async function (...args) {
            const source = await original.apply(this, args);
            if (this.name === "held-config.json") {
              await new Promise((resolve) => { window.releaseCellConfig = resolve; });
              if (outcome === "failure") throw new Error("held Cell Config read failed");
            }
            return source;
          };
        }, outcome);
        await page.locator("#cellConfigInput").setInputFiles(file("held-config.json", JSON.stringify(configuration)));
        await page.waitForFunction(() => window.releaseCellConfig);
        await page.locator("#aigFileInput").setInputFiles(file("current.blif", blif));
        await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded current.blif"));
        const before = await page.evaluate(() => ({ status: document.querySelector("#statusBar").textContent,
          scene: document.querySelector("#schematicContent").innerHTML,
          config: localStorage.getItem("netlistGraphBuilder.cellConfig.v1") }));
        await page.evaluate(() => window.releaseCellConfig());
        await page.waitForFunction(() => document.querySelector("#cellConfigInput").value === "");
        const after = await page.evaluate(() => ({ status: document.querySelector("#statusBar").textContent,
          scene: document.querySelector("#schematicContent").innerHTML,
          config: localStorage.getItem("netlistGraphBuilder.cellConfig.v1") }));
        assert.equal(after.status, before.status, "late Netlist configuration work must preserve the current AIG status");
        assert.equal(after.scene, before.scene);
        assert.deepEqual(dialogs, [], "an inactive Netlist cannot open a configuration conflict dialog");
        if (outcome === "success") {
          assert.equal(JSON.parse(after.config).cells.PROBE.gateKind, "BUF", "the requested global configuration still saves");
          await page.locator("#fileInput").setInputFiles(file("configured.v", "module top(input a, output y); PROBE c(.A(a),.Z(y)); endmodule"));
          await page.locator('#schematicMount [data-node-id="cell:c"] .node-shape').first().click();
          assert.match(await page.locator("#selectionDetails").innerText(), /user-config/);
        } else {
          assert.equal(after.config, before.config);
          if (!await page.locator("#processLogList").isVisible()) await page.locator("#toggleProcessLogButton").click();
          assert.match(await page.locator("#processLogList").textContent(), outcome === "failure"
            ? /Cell Config import failed held-config.json/ : /requires confirmation in the Netlist workspace/);
        }
        report.cases.push({ name: currentCase, status: "passed" });
      } catch (error) {
        await page.screenshot({ path: join(artifacts, `${currentCase}-failure.png`) }).catch(() => {});
        throw error;
      } finally { await context.close(); }
    }
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.externalRequests, []);
  }, { root, chromium, executablePath: process.env.NGB_CHROME });
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.failure = { case: currentCase, message: error.message, stack: error.stack }; process.exitCode = 1;
} finally {
  await writeFile(join(artifacts, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, failure: report.failure, artifacts }));
}
