import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBrowserTest, withBrowserTestTimeout } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const blif = await readFile(new URL("../fixtures/aig/shared_cone.blif", import.meta.url), "utf8");
const latestNetlist = "module latest(input a,b,output y); AND2 latest_gate(.A(a),.B(b),.Y(y)); endmodule";
const startupNetlist = "module obsolete(input a,output y); INV obsolete_gate(.A(a),.Y(y)); endmodule";
const file = (name, text) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
function deferred() {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
}

await runBrowserTest(async ({ browser, url }) => {
  const cases = [];
  for (const domain of ["netlist", "aig"]) {
    for (const outcome of ["response", "failure"]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      const entered = deferred(), release = deferred(), finished = deferred();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/__ngb_startup__.json", async (route) => {
        entered.resolve();
        await release.promise;
        try {
          if (outcome === "failure") await route.fulfill({ status: 500, body: "obsolete startup failure" });
          else await route.fulfill({ json: { version: 1, inputs: {
            netlist: { name: "obsolete.v", text: startupNetlist }
          }, target: {} } });
        } finally { finished.resolve(); }
      });
      try {
        await page.goto(`${url}?startup=1`, { timeout: 30000 });
        await withBrowserTestTimeout(() => entered.promise, 10000, "Startup manifest request");
        await page.locator("#domainToolbar").waitFor({ state: "attached" });
        const name = domain === "aig" ? "latest.blif" : "latest.v";
        await page.locator(domain === "aig" ? "#aigFileInput" : "#fileInput")
          .setInputFiles(file(name, domain === "aig" ? blif : latestNetlist));
        await page.waitForFunction((label) => document.querySelector("#statusBar").textContent.includes(`Loaded ${label}`), name,
          { timeout: 30000 });
        const readView = () => page.evaluate(() => ({
          status: document.querySelector("#statusBar").textContent,
          source: document.querySelector("#sourceBadge").textContent,
          svg: document.querySelector("#schematicMount svg").outerHTML,
          domainVisible: !document.querySelector("#domainToolbar").hidden
        }));
        // Settle the status-driven shell refresh before comparing the view.
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const before = await readView();
        release.resolve();
        await withBrowserTestTimeout(() => finished.promise, 10000, "Obsolete manifest completion");
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.deepEqual(await readView(), before, `${domain}: obsolete ${outcome} must preserve the current document`);
        assert.deepEqual(errors, []);
        assert.equal(before.domainVisible, domain === "aig");
        cases.push({ domain, obsoleteManifest: outcome, status: "passed" });
      } finally {
        release.resolve();
        await context.close();
      }
    }
  }
  console.log(JSON.stringify({ cases, passed: cases.length }, null, 2));
}, { root, chromium, executablePath: process.env.NGB_CHROME || process.env.NGB_CHROMIUM_PATH });
