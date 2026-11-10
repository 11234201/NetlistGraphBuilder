import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [manifestPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error("Usage: node tests/e2e/liberty_synthesis_e2e.mjs manifest.json output-directory");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const actionTimeoutMs = Number(process.env.NGB_LIBERTY_BROWSER_TIMEOUT_MS || 45000);
assert.ok(Number.isInteger(actionTimeoutMs) && actionTimeoutMs >= 45000 && actionTimeoutMs <= 600000);
const diagnostic = actionTimeoutMs !== 45000;
if (diagnostic) console.error(`Diagnostic browser budget ${actionTimeoutMs}ms; this does not pass the default 45s check`);
const output = resolve(outputPath);
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const server = spawn(process.execPath, ["tools/serve.mjs", "--no-browser", "--port", "0"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
server.stderr.on("data", (chunk) => process.stderr.write(chunk));
let browser;
let activePage;
const requests = new Set(), failures = [], pageErrors = [];
try {
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Server startup timeout")), 30000);
    server.stdout.on("data", (chunk) => {
      output += chunk;
      for (const line of output.split("\n")) {
        try { const ready = JSON.parse(line); if (ready.event === "ready") { clearTimeout(timer); resolve(ready.url); } } catch {}
      }
    });
    server.on("error", (error) => { clearTimeout(timer); reject(error); });
    server.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.NGB_CHROME, args: ["--no-sandbox"] });
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
    await page.close();
    activePage = null;
  }
  assert.deepEqual(errors, []);
  const report = { cases: results.length, errors, compareLibraries: manifest.libraries.length, actionTimeoutMs, diagnostic, navigation, results };
  await writeFile(join(output, "browser_report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} catch (error) {
  await writeFile(join(output, "failure.txt"), error.stack + "\n");
  await writeFile(join(output, "failure_requests.json"), JSON.stringify({ pending: [...requests], failures, pageErrors }, null, 2) + "\n");
  if (activePage) {
    await activePage.screenshot({ path: join(output, "failure.png"), timeout: 5000 }).catch(() => {});
    await writeFile(join(output, "failure.html"), await activePage.content().catch(() => ""));
  }
  throw error;
} finally { await browser?.close(); server.kill(); }
