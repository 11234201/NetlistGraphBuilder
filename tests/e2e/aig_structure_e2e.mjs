import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url)), artifacts = join(root, "dc_runs/aig_structure_browser");
await mkdir(artifacts, { recursive: true });
const text = await readFile(new URL("../fixtures/aig/structure_analysis.blif", import.meta.url), "utf8"), cases = [];
const geometry = (page) => page.locator("#schematicMount").evaluate((mount) => [...mount.querySelectorAll(".aig-node-shape,.aig-edge-path")].map((shape) =>
  [shape.parentElement.dataset.aigObject, ...["d", "points", "cx", "cy", "rx", "ry"].map((key) => shape.getAttribute(key))]));
await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true }), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__structureTest = { layouts: 0, analyses: 0, details: 0, hold: false, failDetail: false };
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, { construct(target, args) {
      const worker = Reflect.construct(target, args), send = worker.postMessage.bind(worker);
      worker.postMessage = (value) => {
        if (String(args[0]).includes("graphviz_worker.js")) window.__structureTest.layouts++;
        if (String(args[0]).includes("structure_worker.js") && value.type === "analyze") {
          window.__structureTest.analyses++;
          if (window.__structureTest.hold) return;
        }
        if (String(args[0]).includes("structure_worker.js") && value.type === "detail") {
          window.__structureTest.details++;
          if (window.__structureTest.failDetail) throw new Error("Test path union timeout");
        }
        return send(value);
      }; return worker;
    } });
  });
  try {
    await page.goto(url);
    await page.locator("#aigFileInput").setInputFiles({ name: "structure.blif", mimeType: "text/plain", buffer: Buffer.from(text) });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded structure.blif"));
    await page.locator('[data-aig-nav-tab="analysis"]').click();
    await page.locator('[data-aig-analysis-status="complete"]').waitFor();
    assert.equal(await page.locator("#domainNavigator [data-aig-analysis-select]").count(), 6);
    const before = await geometry(page), calls = await page.evaluate(() => ({ ...window.__structureTest }));
    await page.evaluate(() => { window.__analysisSvg = document.querySelector("#schematicMount svg"); window.__analysisViewport = document.querySelector("#schematicMount svg > g")?.getAttribute("transform"); });
    const pair = page.locator("#domainNavigator [data-aig-analysis-select]").first();
    await pair.click();
    await page.waitForFunction(() => /nodes · \d+ edges \(complete\)/.test(document.querySelector("#domainInspector").textContent));
    assert.ok(await page.locator('[data-aig-analysis-role="a"]').count()); assert.ok(await page.locator('[data-aig-analysis-role="b"]').count());
    assert.deepEqual(await geometry(page), before);
    assert.equal(await page.evaluate(() => document.querySelector("#schematicMount svg") === window.__analysisSvg), true);
    assert.equal(await page.evaluate(() => document.querySelector("#schematicMount svg > g")?.getAttribute("transform") === window.__analysisViewport), true);
    assert.equal(await page.locator('[data-aig-analysis-role="stem"]').count(), 1);
    await page.screenshot({ path: join(artifacts, "reconvergence.png") });
    cases.push("six reconvergence pairs, disjoint witness colors, lazy path union, no geometry or viewport change");
    const relatedBlock = page.locator("#domainInspector [data-aig-analysis-select]").first();
    await relatedBlock.focus(); await relatedBlock.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.aigAnalysisAction), "locate");
    cases.push("keyboard navigation to a related result retains focus in the Inspector");
    await page.locator('[data-aig-analysis-category="block"]').click();
    assert.equal(await page.locator("#domainNavigator [data-aig-analysis-select]").count(), 3);
    await page.locator('[data-aig-filter="structureType"]').selectOption("mux");
    assert.equal(await page.locator("#domainNavigator [data-aig-analysis-select]").count(), 1);
    await page.locator("#domainNavigator [data-aig-analysis-select]").click();
    const rootFormula = await page.locator(".aig-analysis-formula").textContent();
    const [, d1, d0] = rootFormula.match(/ = s \? ¬(\d+) : ¬(\d+)$/);
    assert.equal(await page.locator(".aig-source-list code").textContent(), `MUX2 · s ? ${d1} : ${d0}`);
    assert.match(await page.locator(".aig-source-list li").textContent(), /y · output port · inverted edge/);
    assert.equal(await page.locator('.aig-pin-list li').count(), 3);
    for (const [role, id] of [["D1", d1], ["D0", d0]]) {
      assert.match(await page.locator(".aig-pin-list li").filter({ hasText: role }).textContent(), new RegExp(`${role} ¬${id} inverted`));
    }
    assert.ok(await page.locator('.aig-edge-path[stroke-dasharray="5 4"]').count());
    assert.ok(await page.locator('.aig-block-label').count());
    const muxId = await page.locator('[data-aig-analysis-inspected]').getAttribute('data-aig-analysis-inspected');
    const dim = page.getByRole("checkbox", { name: "Dim outside selected result" });
    const outside = page.locator("#schematicMount [data-domain-object]:not([data-aig-analysis-role])").first();
    const opacity = (element) => getComputedStyle(element).opacity;
    assert.equal(await outside.evaluate(opacity), "0.22");
    await dim.uncheck();
    assert.equal(await outside.evaluate(opacity), "1");
    assert.ok(await page.locator('[data-aig-analysis-role="block"]').count());
    await dim.check();
    assert.equal(await outside.evaluate(opacity), "0.22");
    await page.locator('[data-domain-policy="structureLabels"]').uncheck();
    assert.equal(await page.locator('.aig-block-label').first().isVisible(), false);
    await page.locator('[data-domain-policy="structureLabels"]').check();
    assert.deepEqual(await geometry(page), before);
    assert.equal(await page.evaluate(() => window.__structureTest.layouts), calls.layouts);
    await page.screenshot({ path: join(artifacts, "mux.png") });
    const downloadEvent = page.waitForEvent('download');
    for (const menu of await page.locator('#exportSvgButton').locator('xpath=ancestor::details').all()) {
      if (!await menu.evaluate((element) => element.open)) await menu.locator(':scope > summary').click();
    }
    await page.locator('#exportSvgButton').click();
    const download = await downloadEvent, svg = await readFile(await download.path(), 'utf8');
    assert.match(svg, /aig-block-label/); assert.match(svg, /data-aig-analysis-role="block"/); assert.match(svg, /stroke-dasharray="5 4"/); assert.match(svg, /opacity="0.22"/);
    cases.push("XOR/XNOR/MUX list, pin mapping, labels, dimming, inverted edges and exported analysis");
    await page.locator('[data-domain-policy="viewStyle"]').selectOption('standard');
    await page.waitForFunction(() => document.querySelector('#statusBar').textContent.includes('AIG view: Standard'));
    assert.equal(await page.locator('[data-aig-analysis-inspected]').getAttribute('data-aig-analysis-inspected'), muxId);
    assert.equal(await page.evaluate(() => window.__structureTest.analyses), calls.analyses);
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('ngb.domain-workspace.v1')));
    assert.equal(saved.panels.analysis.selectedId, muxId); assert.doesNotMatch(JSON.stringify(saved.panels), /truthTable|edgeIds|nodeIds/);
    await page.reload(); await page.locator('[data-aig-analysis-status="complete"]').waitFor();
    assert.equal(await page.locator('[data-aig-analysis-inspected]').getAttribute('data-aig-analysis-inspected'), muxId);
    cases.push("Standard reuses results and reload restores selection without serializing analysis artifacts");
    await page.locator('[data-aig-analysis-action="clear"]').click();
    await page.evaluate(() => { window.__structureTest.hold = true; });
    await page.locator('[data-aig-analysis-action="run"]').click(); await page.locator('[data-aig-analysis-status="running"]').waitFor();
    await page.locator('[data-aig-analysis-action="cancel"]').click(); await page.locator('[data-aig-analysis-status="cancelled"]').waitFor();
    assert.equal(await page.locator("#domainNavigator [data-aig-analysis-select]").count(), 0);
    assert.equal(await page.getByText("No results in the current analysis.").count(), 0);
    await page.evaluate(() => { window.__structureTest.hold = false; });
    await page.locator('[data-aig-analysis-action="run"]').click(); await page.locator('[data-aig-analysis-status="complete"]').waitFor();
    cases.push("cancellation and retry preserve the visible graph without runtime errors");
    await page.evaluate(() => { window.__structureTest.hold = true; });
    await page.locator("#aigFileInput").setInputFiles({ name: "cancel-before-results.blif", mimeType: "text/plain", buffer: Buffer.from(text) });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded cancel-before-results.blif"));
    await page.locator('[data-aig-nav-tab="analysis"]').click();
    await page.locator('[data-aig-analysis-status="running"]').waitFor();
    await page.waitForFunction(() => window.__structureTest.analyses > 0);
    await page.locator('[data-aig-analysis-action="cancel"]').click();
    const cancelledCalls = await page.evaluate(() => window.__structureTest.analyses);
    await page.locator('[data-domain-policy="viewStyle"]').selectOption('standard');
    await page.waitForFunction(() => document.querySelector('#statusBar').textContent.includes('AIG view: Standard'));
    await page.locator('[data-aig-analysis-status="cancelled"]').waitFor();
    assert.equal(await page.evaluate(() => window.__structureTest.analyses), cancelledCalls);
    await page.evaluate(() => { window.__structureTest.hold = false; });
    await page.locator('[data-aig-analysis-action="run"]').click(); await page.locator('[data-aig-analysis-status="complete"]').waitFor();
    assert.equal(await page.locator("#domainNavigator [data-aig-analysis-select]").count(), 6);
    cases.push("cancelling before first results remains cancelled across a Standard relayout until explicit retry");
    await page.evaluate(() => { window.__structureTest.failDetail = true; });
    await pair.click();
    const detailFailure = page.locator("#domainInspector").getByText("Test path union timeout", { exact: true });
    await detailFailure.waitFor();
    const logEntry = page.locator("#processLogList .level-error").filter({ hasText: "Test path union timeout" });
    await logEntry.locator("summary").click();
    const diagnostic = JSON.parse(await logEntry.locator("pre").innerText());
    assert.equal(diagnostic.operation, "reconvergence.detail");
    assert.ok(diagnostic.jobId && diagnostic.resultId && diagnostic.error.stack);
    const logDownload = page.waitForEvent("download");
    await page.locator("#exportProcessLogButton").click();
    const logText = await readFile(await (await logDownload).path(), "utf8");
    assert.equal(logText.trim().split("\n").map(JSON.parse).filter((row) => row.details?.jobId === diagnostic.jobId && row.level === "error").length, 1);
    const failedAttempts = await page.evaluate(() => window.__structureTest.details);
    await page.locator('[data-domain-policy="viewStyle"]').selectOption("abc");
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent === "AIG view: Logic View");
    assert.equal(await page.evaluate(() => window.__structureTest.details), failedAttempts);
    assert.equal(await detailFailure.isVisible(), true);
    await page.evaluate(() => { window.__structureTest.failDetail = false; });
    await pair.click();
    await page.waitForFunction(() => /nodes · \d+ edges \(complete\)/.test(document.querySelector("#domainInspector").textContent));
    assert.equal(await page.evaluate(() => window.__structureTest.details), failedAttempts + 1);
    cases.push("switching views preserves a path detail error, and selecting the pair again retries once");
    const ports = Array.from({ length: 201 }, (_, i) => `y${i}`);
    const fanout = [".model fanout", ".inputs a b", `.outputs ${ports.join(" ")}`,
      ".names a b p", "10 1", ".names a b q", "01 1", ".names p q root", "00 1",
      ...ports.flatMap((name) => [`.names root ${name}`, "1 1"]), ".end"].join("\n");
    await page.locator("#aigFileInput").setInputFiles({ name: "fanout.blif", mimeType: "text/plain", buffer: Buffer.from(fanout) });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded fanout.blif"));
    await page.locator('[data-aig-nav-tab="analysis"]').click();
    await page.locator('[data-aig-analysis-status="complete"]').waitFor();
    await page.locator('[data-aig-analysis-category="block"]').click();
    await page.locator("#domainNavigator [data-aig-analysis-select]").click();
    const pager = page.locator("#domainInspector .inspection-pager");
    await pager.getByRole("button", { name: "Next" }).focus();
    for (const [indicator, direction] of [["2 / 3", "Next"], ["3 / 3", "Previous"], ["2 / 3", "Previous"]]) {
      await page.keyboard.press("Enter");
      assert.equal(await pager.locator("span").textContent(), indicator);
      assert.equal(await page.evaluate(() => document.activeElement.textContent), direction);
    }
    cases.push("keyboard paging through 201 block output uses retains direction and reverses at the boundary");
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, 'results.json'), JSON.stringify({ cases, errors }, null, 2));
    console.log(JSON.stringify({ cases, errors }, null, 2));
  } finally { await page.close(); }
}, { root, chromium, executablePath: process.env.NGB_CHROME || '/usr/bin/google-chrome' });
