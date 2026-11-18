import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const source = `module top(input s,output z);
  wire p,q; BUF b1(.A(s),.Y(p)); INV b2(.A(s),.Y(q)); NAND2 m(.A(p),.B(q),.Y(z)); endmodule
module peer(input s,output z);
  wire x,y; BUF c1(.A(y),.Y(x)); BUF c2(.A(x),.Y(y)); BUF out1(.A(s),.Y(z)); endmodule`;

await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.reconTest = { analyses: 0, details: 0, fail: "", hold: false };
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, { construct(target, args) {
      const worker = Reflect.construct(target, args);
      if (String(args[0]).includes("reconvergence_worker.js")) {
        const send = worker.postMessage.bind(worker);
        worker.postMessage = (request) => {
          if (request.type === "analyze") window.reconTest.analyses++;
          if (request.type === "detail") window.reconTest.details++;
          if (request.type === window.reconTest.fail) throw new Error("Injected netlist " + request.type + " failure", { cause: new Error("test worker cause") });
          if (request.type === "analyze" && window.reconTest.hold) return;
          return send(request);
        };
      }
      return worker;
    } });
  });
  const panel = page.locator("#netlistAnalysis"), detail = page.locator("#netlistAnalysisDetail");
  const result = panel.locator("[data-recon-result]");
  const button = (action) => page.locator(`[data-recon-action="${action}"]`);
  const status = (value) => panel.locator(`[data-recon-status="${value}"]`).waitFor();
  const clickVisible = async (selector) => {
    const target = page.locator(selector);
    for (const menu of await target.locator("xpath=ancestor::details").all()) {
      if (!await menu.evaluate((element) => element.open)) await menu.locator(":scope > summary").click();
    }
    await target.click();
  };
  try {
    await page.goto(url);
    await page.locator("#schematicMount svg").waitFor();
    await page.locator("#fileInput").setInputFiles({ name: "recon.v", mimeType: "text/plain", buffer: Buffer.from(source) });
    await page.locator('#schematicMount [data-node-id="cell:b1"]').waitFor();
    await clickVisible('[data-nav-tab="analysis"]'); await status("complete");
    assert.equal(await result.count(), 1);
    const viewport = () => page.locator("#schematicMount #schematicContent").getAttribute("transform");
    const before = await viewport();
    await result.click();
    await page.waitForFunction(() => /Connections between endpoints\s*complete/.test(document.querySelector("#netlistAnalysisDetail").textContent));
    assert.match(await detail.textContent(), /Path 1 · 2 gates · 2 edges/);
    assert.equal(await viewport(), before);
    assert.ok(await page.locator("#schematicMount .edge[data-recon-role]").count() >= 4);
    const calls = await page.evaluate(() => window.reconTest.analyses);
    await button("locate").click();
    assert.equal(await page.evaluate(() => window.reconTest.analyses), calls);
    await button("clear").click();
    await page.locator('#schematicMount [data-node-id="cell:b1"] .node-shape').first().click();
    await detail.locator("[data-recon-result]").first().waitFor();

    await page.evaluate(() => { window.reconTest.fail = "analyze"; });
    await button("run").click(); await status("error");
    assert.equal(await detail.locator("[data-recon-result]").count(), 0);
    await page.evaluate(() => { window.reconTest.fail = "detail"; });
    await button("run").click(); await status("complete");
    await result.click();
    await detail.getByText("Injected netlist detail failure").waitFor();
    await page.evaluate(() => { window.reconTest.fail = ""; });
    await button("retry-detail").click();
    await page.waitForFunction(() => /Connections between endpoints\s*complete/.test(document.querySelector("#netlistAnalysisDetail").textContent));
    await page.evaluate(() => { window.reconTest.hold = true; });
    await button("run").click(); await status("running");
    await button("cancel").click(); await status("cancelled");
    assert.equal(await detail.locator("[data-recon-result]").count(), 0);
    await page.evaluate(() => { window.reconTest.hold = false; });

    await page.locator('#schematicMount [data-node-id="cell:b1"] .node-shape').first().click();
    await clickVisible("#setFocusedRootButton");
    await page.waitForFunction(() => document.querySelector("#netlistAnalysis").textContent.includes("focused"));
    await status("complete");
    assert.equal(await result.count(), 0);
    assert.equal(await page.locator("#schematicMount [data-recon-role]").count(), 0);
    await clickVisible("#wholeViewButton");
    await result.waitFor(); await status("complete");

    await clickVisible("#compareButton");
    await page.locator("#leftModuleSelect").selectOption("top");
    await page.locator("#rightModuleSelect").selectOption("peer");
    await clickVisible("#applyCompareButton");
    await page.locator("#rightSchematicMount svg").waitFor();
    await panel.getByText(/Side A · top/).waitFor();
    await result.waitFor(); await result.click();
    assert.ok(await page.locator("#leftSchematicMount [data-recon-role]").count() > 0);
    assert.equal(await page.locator("#rightSchematicMount [data-recon-role]").count(), 0);
    await button("right").click(); await status("partial");
    assert.match(await panel.textContent(), /Side B · peer/);
    assert.match(await panel.textContent(), /combinational-cycle/);
    assert.equal(await result.count(), 0);
    assert.doesNotMatch(await detail.textContent(), /Side A/);
    const peerNode = page.locator('#rightSchematicMount [data-node-id="cell:out1"] .node-shape').first();
    await peerNode.click();
    await button("left").click();
    await panel.getByText(/Side A · top/).waitFor();
    await peerNode.click();
    await panel.getByText(/Side B · peer/).waitFor();
    assert.equal(await result.count(), 0);

    if (!await page.locator("#exportProcessLogButton").isVisible()) await clickVisible("#toggleProcessLogButton");
    const logEntry = page.locator("#processLogList .level-error").filter({ hasText: "Injected netlist detail failure" }).first();
    await logEntry.locator("summary").click();
    const diagnostic = JSON.parse(await logEntry.locator("pre").innerText());
    assert.equal(diagnostic.operation, "reconvergence.detail");
    assert.ok(diagnostic.error.stack && diagnostic.viewScopeId && diagnostic.resultId);
    const download = page.waitForEvent("download");
    await page.locator("#exportProcessLogButton").click();
    const jsonl = await readFile(await (await download).path(), "utf8");
    const logs = jsonl.trim().split("\n").map(JSON.parse).filter((row) => row.details?.domainId === "netlist");
    for (const operation of ["reconvergence.run", "reconvergence.detail"]) {
      const failures = logs.filter((row) => row.level === "error" && row.details.operation === operation);
      assert.equal(failures.length, 1); assert.equal(failures[0].details.side, "single");
    }
    assert.ok(logs.some((row) => row.level === "warning" && row.details.side === "right" && row.details.reasons.includes("combinational-cycle")));
    assert.deepEqual(errors, []);
    console.log("Netlist Whole/Focused, Compare isolation, witnesses, detail/highlight, cancel, worker failure/retry and Process Log JSONL passed.");
  } finally { await page.close(); }
}, { root, chromium, executablePath: process.env.NGB_CHROME });
