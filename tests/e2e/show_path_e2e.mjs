import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const source = `module top(input a,input b,output z,output w);
  wire p; BUF g1(.A(a),.Y(p)); NAND2 g2(.A(p),.B(b),.Y(z)); BUF isolated(.A(b),.Y(w)); endmodule
module peer(input a,input b,output z); NOR2 g3(.A(a),.B(b),.Y(z)); endmodule`;
const blif = ".model top\n.inputs a b\n.outputs z w\n.names a b z\n11 1\n.names b w\n1 1\n.end";
await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error(error); });
  const menu = page.locator("#showPathMenu");
  async function open() { if (!await menu.evaluate((el) => el.open)) await menu.locator(":scope > summary").click(); }
  const action = (name) => menu.locator(`[data-path-action="${name}"]`);
  const file = (name, text) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  async function add(term, side, match) {
    await open(); await page.locator("#pathFind").fill(term);
    await page.locator("#pathCandidates .path-row").filter({ hasText: match }).first().locator(`[data-path-action="${side}"]`).click();
  }
  async function apply() {
    await action("apply").click();
    await page.waitForFunction(() => document.querySelector("#showPathMenu").hasAttribute("data-enabled") &&
      document.querySelector('[data-path-action="cancel"]').hidden);
  }
  async function download(id) {
    const waiting = page.waitForEvent("download");
    await page.locator(id).evaluate((el) => el.click());
    return readFile(await (await waiting).path(), "utf8");
  }
  try {
    await page.goto(url);
    await page.locator("#fileInput").setInputFiles(file("path.v", source));
    await page.locator('#schematicMount [data-node-id="cell:isolated"]').waitFor();
    for (const width of [760, 900, 1366, 1920]) {
      await page.setViewportSize({ width, height: 768 });
      assert.ok((await page.locator("#workspaceTitle").boundingBox()).width > 10);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await open();
    await action("apply").click();
    assert.match(await page.locator("#pathMessage").textContent(), /at least one/i);
    await page.locator("#searchInput").fill("a");
    const inputRow = page.locator(".search-result").filter({ has: page.locator(".search-result-label", { hasText: /^a$/ }) })
      .filter({ hasText: "top" }).first();
    await inputRow.locator("[data-search-actions]").click();
    await inputRow.locator('[data-search-path="starts"]').click();
    await page.waitForFunction(() => document.querySelector("#pathDraft").textContent.includes("Starts (1)"));
    await add("output:z", "ends", /z · output/);
    await apply();
    assert.equal(await page.locator('#schematicMount [data-node-id="cell:isolated"]').count(), 0);
    assert.match(await page.locator("#pathReportBody").textContent(), /To selected end 2 · From start 0/);
    await action("tab-ends").click();
    assert.match(await page.locator("#pathReportBody").textContent(), /To selected end 0 · From start 2/);
    assert.match(await download("#exportSvgButton"), /To selected end 2 · From start 0/);
    await add("input:b", "starts", /b · input/);
    await action("toggle").click();
    await page.locator('#schematicMount [data-node-id="cell:isolated"]').waitFor();
    assert.match(await page.locator("#pathDraft").textContent(), /Starts \(2\)/);
    await action("toggle").click();
    await page.waitForFunction(() => document.querySelector("#showPathMenu").hasAttribute("data-enabled") &&
      document.querySelector('[data-path-action="cancel"]').hidden);
    assert.match(await page.locator("#pathReportBody").textContent(), /Starts \(1\)/);
    await page.locator('#pathDraft button[aria-label="Remove b"]').click();
    const goldenText = await download("#saveGoldenButton");
    assert.equal(JSON.parse(goldenText).version, 4);
    // Interrupt or fail the detached candidate after the provider has returned.
    // The same live SVG must survive both operations.
    await add("output:w", "ends", /w · output/);
    for (const mode of ["cancel", "fail", "budget"]) {
      await page.evaluate(async (mode) => {
        let budgetError;
        if (mode === "budget") {
          const { checkPathBudget } = await import("/src/analysis/path_query.js");
          try { checkPathBudget(400001); } catch (error) { budgetError = error; }
        }
        window.savedPathSvg = document.querySelector("#schematicMount svg");
        const original = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
        Object.defineProperty(Element.prototype, "innerHTML", { ...original, set(value) {
          if (!this.isConnected && typeof value === "string" && value.startsWith("<svg")) {
            Object.defineProperty(Element.prototype, "innerHTML", original);
            if (budgetError) throw budgetError;
            if (mode === "fail") throw new Error("injected detached Path render", { cause: new Error("Path render cause") });
            document.querySelector('[data-path-action="cancel"]').click();
          }
          original.set.call(this, value);
        } });
      }, mode);
      await action("apply").click();
      await page.waitForFunction(() => document.querySelector('[data-path-action="cancel"]').hidden);
      assert.ok(await page.evaluate(() => window.savedPathSvg === document.querySelector("#schematicMount svg")));
      assert.match(await page.locator("#pathMessage").textContent(), mode === "cancel" ? /Cancelled/ : mode === "budget" ? /400001/ : /injected detached/);
    }
    const logs = (await download("#exportProcessLogButton")).trim().split(/\r?\n/).map(JSON.parse);
    const budget = logs.find((r) => r.details?.code === "show-path.budget");
    assert.equal(budget.level, "warning"); assert.equal(budget.details.objectLimit, 400000);
    const failed = logs.filter((r) => r.details?.error?.message === "injected detached Path render");
    assert.equal(failed.length, 1); assert.equal(failed[0].details.retainedPreviousView, true);
    assert.match(failed[0].details.error.cause.message, /Path render cause/);
    const detail = page.locator("#processLogList li").filter({ hasText: "injected detached Path render" }).last();
    await detail.locator("summary").evaluate((el) => el.click());
    assert.match(await detail.locator("pre").textContent(), /show-path.apply/);
    await page.reload(); await page.locator("#showPathMenu[data-enabled]").waitFor();
    await open(); await action("toggle").click();
    await page.locator('#schematicMount [data-node-id="cell:isolated"]').waitFor();
    await page.locator("#moduleBackButton").evaluate((el) => el.click());
    await page.locator("#showPathMenu[data-enabled]").waitFor();
    await open(); await action("clear").click();
    await page.locator('#schematicMount [data-node-id="cell:isolated"]').waitFor();
    await page.locator("#goldenInput").setInputFiles(file("path-golden.json", goldenText));
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded Golden"));
    await page.locator("#showPathMenu[data-enabled]").waitFor();
    assert.equal(await page.locator('#schematicMount [data-node-id="cell:isolated"]').count(), 0);
    await page.locator("#compareButton").evaluate((el) => el.click());
    await page.locator('#rightSchematicMount [data-node-id="cell:g3"]').waitFor();
    await open(); await page.locator("#pathSide").selectOption("right");
    await add("input:b", "starts", /b · input/);
    await page.locator("#pathSide").selectOption("left");
    assert.match(await page.locator("#pathDraft").textContent(), /Starts \(0\)/);
    await page.locator("#pathSide").selectOption("right");
    assert.match(await page.locator("#pathDraft").textContent(), /Starts \(1\)b/);
    await page.evaluate(() => {
      const left = document.querySelector("#leftSchematicMount"), right = document.querySelector("#rightSchematicMount");
      window.previousCompareViews = [left.firstChild, right.firstChild];
      right.replaceChildren = function () { delete this.replaceChildren; throw new Error("injected Compare mount failure"); };
    });
    await action("apply").click();
    await page.waitForFunction(() => document.querySelector("#pathMessage").textContent.includes("injected Compare mount failure"));
    assert.ok(await page.evaluate(() => ["left", "right"].every((side, i) =>
      document.querySelector("#" + side + "SchematicMount").firstChild === window.previousCompareViews[i])));
    assert.equal(await menu.getAttribute("data-enabled"), null);
    const compareErrors = (await download("#exportProcessLogButton")).trim().split(/\r?\n/).map(JSON.parse)
      .filter((row) => row.details?.error?.message === "injected Compare mount failure");
    assert.equal(compareErrors.length, 1);
    assert.equal(compareErrors[0].details.side, "right");
    await apply();
    assert.equal(await page.locator('#rightSchematicMount [data-node-id="input:a"]').count(), 0);
    assert.ok(await page.locator('#leftSchematicMount [data-node-id="cell:isolated"]').count());
    assert.match(await download('#pathReportBody [data-path-action="export"]'), /peer · right/);
    await page.locator("#pathSide").selectOption("left");
    await add("input:a", "starts", /a · input/); await add("output:z", "ends", /z · output/); await apply();
    assert.equal(await page.locator('#leftSchematicMount [data-node-id="cell:isolated"]').count(), 0);
    assert.equal(await page.locator('#rightSchematicMount [data-node-id="input:a"]').count(), 0);
    await page.reload(); await page.locator('#rightSchematicMount [data-node-id="cell:g3"]').waitFor();
    assert.equal(await page.locator('#leftSchematicMount [data-node-id="cell:isolated"]').count(), 0);
    assert.equal(await page.locator('#rightSchematicMount [data-node-id="input:a"]').count(), 0);
    // Leave Compare through a search hit in the prior Single module. The mount
    // may have been interrupted when Compare opened and must be rebuilt.
    await page.locator("#fileInput").setInputFiles(file("three.v", source +
      "\nmodule spare(input k,output o); BUF spareGate(.A(k),.Y(o)); endmodule"));
    await page.locator('#schematicMount [data-node-id="cell:isolated"]').waitFor();
    await page.locator("#compareButton").evaluate((el) => el.click());
    await page.locator("#leftModuleSelect").selectOption("spare");
    await page.locator("#rightModuleSelect").selectOption("peer");
    await page.locator("#applyCompareButton").click();
    await page.locator('#leftSchematicMount [data-node-id="cell:spareGate"]').waitFor();
    await page.locator("#schematicMount svg").evaluate((svg) => svg.dataset.beforeReturn = "true");
    await page.locator("#searchInput").fill("isolated");
    const singleHit = page.locator(".search-result").filter({ hasText: "isolated" }).first();
    await singleHit.locator("[data-search-actions]").click();
    await singleHit.locator('[data-search-path="ends"]').click();
    await page.waitForFunction(() => document.querySelector("#pathDraft").textContent.includes("Ends (1)isolated") &&
      !document.querySelector("#schematicMount svg[data-before-return]"));
    await page.locator("#aigFileInput").setInputFiles(file("path.blif", blif));
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded path.blif"));
    await open(); await action("apply").click();
    const diagnostic = (await download("#exportProcessLogButton")).trim().split(/\r?\n/).map(JSON.parse)
      .filter((r) => r.details?.code === "show-path.empty-query");
    assert.equal(diagnostic.length, 1); assert.ok(diagnostic[0].details.error.stack && diagnostic[0].details.sessionId);
    await add("a", "starts", /^a · pi/); await add("z", "ends", /^z · po/); await apply();
    assert.match(await page.locator("#pathReportBody").textContent(), /To selected end 1 · From start 0/);
    assert.match(await download("#exportSvgButton"), /To selected end 0 · From start 1/);
    await add("b", "starts", /^b · pi/); await add("w", "ends", /^w · po/); await apply();
    assert.match(await page.locator("#pathReportBody").textContent(), /Starts \(2\).*Ends \(2\)/);
    await action("tab-starts").click();
    await page.locator("#pathReportBody .path-row").filter({ hasText: /^a/ }).locator('[data-path-action="from"]').click();
    assert.match(await page.locator("#pathReportBody .path-row").filter({ hasText: /^w/ }).innerText(), /From start —.*unreachable/);
    await action("all").click();
    assert.match(await page.locator("#pathReportBody .path-row").filter({ hasText: /^w/ }).innerText(), /From start 0.*visible/);
    await page.evaluate(() => {
      const original = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        HTMLAnchorElement.prototype.click = original;
        throw new Error("injected Show Path SVG download");
      };
      document.querySelector("#exportSvgButton").click();
    });
    assert.ok((await download("#exportProcessLogButton")).includes("injected Show Path SVG download"));
    await page.reload(); await page.locator("#showPathMenu[data-enabled]").waitFor();
    await open(); await action("clear").click(); await page.waitForFunction(() => !document.querySelector("#showPathMenu").hasAttribute("data-enabled"));
    await add("a", "starts", /^a · pi/); await add("w", "ends", /^w · po/); await apply();
    assert.match(await page.locator("#pathReportBody").textContent(), /No path.*unreachable/);
    await page.addInitScript(() => {
      const key = "ngb.domain-workspace.v1", value = JSON.parse(sessionStorage.getItem(key));
      value.focus.showPath.starts = ["obsolete-pi"]; sessionStorage.setItem(key, JSON.stringify(value));
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded path.blif"));
    await page.waitForFunction(() => !document.querySelector("#showPathMenu").hasAttribute("data-enabled"));
    assert.match(await download("#exportProcessLogButton"), /show-path.restore/);
    await page.locator("#fileInput").setInputFiles(file("ambiguous.v",
      "module m(input a,input b,output z,output ok); BUF X(.A(a),.Y(z)); BUF Y(.A(b),.Y(z)); BUF V(.A(a),.Y(ok)); endmodule"));
    await page.locator('#schematicMount [data-node-id="cell:X"]').waitFor();
    await add("input:a", "starts", /a · input/); await add("output:ok", "ends", /ok · output/); await apply();
    await action("tab-starts").click();
    assert.match(await page.locator("#pathReportBody").innerText(), /To selected end 1 · From start 0/);
    const uncertain = (await download("#exportProcessLogButton")).trim().split(/\r?\n/).map(JSON.parse)
      .filter((r) => r.details?.code === "show-path.distance-unknown");
    assert.equal(uncertain.length, 0, "the unrelated ambiguous output must not affect the selected end");
    await page.locator('#pathDraft button[aria-label="Remove ok"]').click();
    await add("output:z", "ends", /z · output/); await apply();
    assert.match(await page.locator("#pathReportBody").textContent(), /partial.*multiple-drivers/);
    const warnings = (await download("#exportProcessLogButton")).trim().split(/\r?\n/).map(JSON.parse)
      .filter((r) => r.details?.code === "show-path.partial");
    assert.equal(warnings.length, 1); assert.equal(warnings[0].level, "warning");
    await page.locator("#aigFileInput").setInputFiles(fileURLToPath(new URL("../../examples/aig_structure_demo.blif", import.meta.url)));
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded aig_structure_demo.blif"));
    await add("y", "ends", /^y · po/); await apply(); await action("tab-starts").click();
    const inputs = await page.locator("#pathReportBody .path-row span").allInnerTexts();
    assert.deepEqual(inputs.map((row) => row.split("\n").slice(0, 2)), ["a", "b", "c", "s"].map((name) =>
      [name, "To selected end " + (name === "s" ? 2 : 4) + " · From start 0 · visible"]));
    assert.deepEqual(errors, []);
    console.log("Show Path Netlist/AIG/Compare, levels, refresh, undo, clear, JSONL and SVG passed.");
  } finally { await page.close(); }
}, { root, chromium, executablePath: process.env.NGB_CHROME });
