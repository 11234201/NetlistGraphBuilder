import assert from "node:assert/strict";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { runBrowserTest, withBrowserTestTimeout } from "./browser_test_session.mjs";

const [manifestPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error("Usage: node tests/e2e/liberty_synthesis_e2e.mjs manifest.json output-directory");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const actionTimeoutMs = Number(process.env.NGB_LIBERTY_BROWSER_TIMEOUT_MS || 45000);
assert.ok(Number.isInteger(actionTimeoutMs) && actionTimeoutMs >= 45000 && actionTimeoutMs <= 600000);
const diagnostic = actionTimeoutMs !== 45000;
if (diagnostic) console.error(`Diagnostic browser budget ${actionTimeoutMs}ms; this does not pass the default 45s check`);
const output = resolve(outputPath);
await mkdir(output, { recursive: true });
await rm(join(output, "browser_report.json"), { force: true });
const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
let activePage;
const requests = new Set(), failures = [], pageErrors = [];
const report = await runBrowserTest(async ({ browser, url }) => {
try {
  const results = [], errors = pageErrors;
  const navigation = [];
  for (const library of manifest.libraries) {
    console.error(`Browser ${library.name}: opening workbench`);
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    activePage = page;
    page.on("request", (request) => requests.add(request.url()));
    page.on("requestfinished", (request) => requests.delete(request.url()));
    page.on("requestfailed", (request) => { requests.delete(request.url()); failures.push({ url: request.url(), error: request.failure() }); });
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(actionTimeoutMs);
    const navigationStarted = performance.now();
    await page.goto(url);
    await page.locator("#schematicMount svg").waitFor();
    navigation.push({ library: library.name, elapsedMs: Math.round(performance.now() - navigationStarted) });
    console.error(`Browser ${library.name}: importing library`);
    await page.locator("#libertyInput").setInputFiles(library.path);
    await page.waitForFunction((name) => document.querySelector("#statusBar").textContent.includes(`Loaded Liberty ${name}`), basename(library.path));
    assert.match(await page.locator("#libertySummary").innerText(), /0 warnings/);
    let lastExpected, lastNetlist;
    for (const caseName of ["dp_001", "eq_001", "sop_001"]) {
      console.error(`Browser ${library.name}/${caseName}: importing netlist`);
      const entry = manifest.cases.find((item) => item.library === library.name && item.name === caseName);
      assert.equal(entry?.status, "passed");
      const expected = JSON.parse(await readFile(entry.design, "utf8")).modules[manifest.top];
      lastExpected = expected;
      lastNetlist = entry.netlist;
      await page.locator("#fileInput").setInputFiles(entry.netlist);
      await page.waitForFunction((name) => document.querySelector("#statusBar").textContent.includes(`Loaded ${name}`), basename(entry.netlist));
      await page.waitForFunction((count) => document.querySelectorAll('#schematicMount [data-kind="cell"]').length === count, Object.keys(expected.cells).length);
      const cells = page.locator('#schematicMount [data-kind="cell"]');
      assert.equal(await cells.count(), Object.keys(expected.cells).length, "Rendered mapped cell count differs");
      const selected = cells.first();
      const instance = (await selected.getAttribute("data-label")).replace(/^\\/, "").trim();
      assert.ok(expected.cells[instance], `Rendered cell ${instance} absent from Yosys`);
      await selected.dispatchEvent("pointerdown", { button: 0, bubbles: true, pointerId: 1, pointerType: "mouse" });
      assert.match(await selected.getAttribute("class"), /is-selected/);
      const details = await page.locator("#selectionDetails").innerText();
      assert.ok(details.includes(basename(library.path)), "Library source not displayed");
      assert.ok(details.includes(expected.cells[instance].type), "Selected type differs");
      assert.match(details, /Inference\s+library/);
      results.push({ library: library.name, case: caseName, cells: await cells.count(), selectedInstance: instance, status: "passed" });
      console.error(`Browser ${library.name}/${caseName}: passed`);
    }
    // Compare requires distinct module names. Duplicate the real mapped SOP module,
    // changing only the second module declaration; cell instances and pins stay intact.
    const mappedSource = await readFile(lastNetlist, "utf8");
    const peerSource = mappedSource.replace(/^module\s+tc(\s*\()/m, "module tc_peer$1");
    assert.notEqual(peerSource, mappedSource, "Expected the synthesized tc module declaration");
    const comparePath = join(output, `${library.name}_compare.v`);
    await writeFile(comparePath, mappedSource + "\n" + peerSource);
    await page.locator("#fileInput").setInputFiles(comparePath);
    await page.waitForFunction((name) => document.querySelector("#statusBar").textContent.includes(`Loaded ${name}`), basename(comparePath));
    await page.locator("#compareButton").evaluate((button) => button.click());
    console.error(`Browser ${library.name}: checking Compare`);
    assert.ok(!(await page.locator("#statusBar").innerText()).includes("requires at least two modules"));
    for (const side of ["left", "right"]) {
      const cell = page.locator(`#${side}SchematicMount [data-kind="cell"]`).first();
      await cell.waitFor();
      assert.equal(await page.locator(`#${side}SchematicMount [data-kind="cell"]`).count(), Object.keys(lastExpected.cells).length);
      await cell.dispatchEvent("pointerdown", { button: 0, bubbles: true, pointerId: 1, pointerType: "mouse" });
      assert.match(await cell.getAttribute("class"), /is-selected/);
      const details = await page.locator("#selectionDetails").innerText();
      assert.match(details, new RegExp(`Compare side\\s+${side}`));
      assert.match(details, /Inference\s+library/);
      assert.ok(details.includes(basename(library.path)));
    }
    await page.locator("#libertySummary").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `${library.name}_compare.png`) });
    await withBrowserTestTimeout(() => page.close(), actionTimeoutMs, "Mapped page shutdown");
    activePage = null;
  }
  assert.deepEqual(errors, []);
  return { cases: results.length, errors, compareLibraries: manifest.libraries.length, actionTimeoutMs, diagnostic, navigation, results };
} catch (error) {
  await writeFile(join(output, "failure.txt"), error.stack + "\n");
  await writeFile(join(output, "failure_requests.json"), JSON.stringify({ pending: [...requests], failures, pageErrors }, null, 2) + "\n");
  if (activePage) {
    await activePage.screenshot({ path: join(output, "failure.png"), timeout: 5000 }).catch(() => {});
    await writeFile(join(output, "failure.html"), await withBrowserTestTimeout(() => activePage.content(), 5000, "Failure page snapshot").catch(() => ""));
  }
  throw error;
}
}, { root, chromium, executablePath: process.env.NGB_CHROME }).catch(async (error) => {
  await writeFile(join(output, "failure.txt"), inspect(error, { depth: 6 }) + "\n");
  throw error;
});
const completed = { ...report, cleanup: "passed" };
await writeFile(join(output, "browser_report.json"), JSON.stringify(completed, null, 2) + "\n");
console.log(JSON.stringify(completed));
