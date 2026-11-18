import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const example = await readFile(new URL("../../examples/aig_mapped_names.blif", import.meta.url), "utf8");
const file = (name, contents) => ({ name, mimeType: "text/plain", buffer: Buffer.from(contents) });

await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function downloadText(button) {
    const ready = page.waitForEvent("download");
    await page.locator(button).click();
    return readFile(await (await ready).path(), "utf8");
  }
  try {
    await page.goto(url);
    await page.evaluate((sample) => {
      const transfer = new DataTransfer();
      const header = "# n0 dp_add_2_cp_temp3_combined/in_96\n".repeat(2000);
      transfer.items.add(new File([header, "# n93 missing_signal\n", sample], "names.txt", { type: "text/plain" }));
      window.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, example);
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded names.txt"));
    await page.locator("#searchInput").fill("in_96");
    const result = page.locator("#searchResults .search-result-main").filter({ hasText: "in_96" });
    assert.match(await result.textContent(), /n0 → n\d+/);
    await result.click();
    await page.locator('[data-aig-inspector-tab="source"]').click();
    assert.match(await page.locator("#domainInspector").textContent(), /Mapped names.*in_96/s);

    await page.locator('[data-aig-nav-tab="names"]').click();
    await page.locator('[data-aig-filter="nameQuery"]').fill("u_gen_4388");
    const rows = page.locator('#domainNavigator tbody tr');
    assert.equal(await rows.count(), 2);
    assert.match(await rows.first().textContent(), /Driver/);
    assert.match(await rows.last().textContent(), /Output port/);
    await rows.last().locator("[data-aig-select]").click();
    assert.match(await page.locator("#domainInspector").textContent(), /u_gen_4388notBoutput/);
    const helper = page.locator("#schematicMount [data-aig-node]").filter({
      has: page.locator("title", { hasText: "Generated for .names n4" })
    }).first();
    await helper.click();
    assert.match(await page.locator("#domainInspector").textContent(), /Generated for .names/);
    await page.locator("#fileMenu summary").click();
    const svg = await downloadText("#exportSvgButton");
    assert.match(svg, /in_96/);
    assert.match(svg, /Generated for .names n4/);

    await page.locator("#aigFileInput").setInputFiles(file("bad_cover.blif", ".model bad\n.inputs a b\n.outputs y\n.names a b y\nxx 1\n.end"));
    await page.locator("#processLogList .level-error").filter({ hasText: "bad_cover.blif" }).first().waitFor();
    const entry = page.locator("#processLogList .level-error").filter({ hasText: "bad_cover.blif" }).first();
    await entry.locator("summary").click();
    assert.match(await entry.locator("pre").innerText(), /blif.cover-value/);
    const badPaste = "\n\n.model paste\n.inputs a\n.outputs y\n.names a y\nx 1\n.end";
    await page.locator("#pasteAigButton").evaluate((button) => button.click());
    await page.locator("#netlistTextInput").fill(badPaste);
    await page.locator("[data-text-submit]").click();
    await page.waitForFunction(() => document.querySelector("[data-text-status]").textContent.includes("Paste failed"));
    assert.equal(await page.locator("#netlistTextInput").inputValue(), badPaste);
    await page.locator("#cancelNetlistTextButton").click();
    const lines = (await downloadText("#exportProcessLogButton")).trim().split(/\r?\n/).map(JSON.parse);
    const invalid = lines.filter((row) => row.details?.fileName === "bad_cover.blif" && row.details?.error?.diagnostic?.code === "blif.cover-value");
    assert.equal(invalid.length, 1);
    assert.equal(invalid[0].details.error.diagnostic.line, 5);
    assert.equal(invalid[0].details.error.diagnostic.objectId, "y");
    assert.ok(invalid[0].details.error.stack);
    const pasteFailures = lines.filter((row) => row.details?.operation === "paste-text");
    assert.equal(pasteFailures.length, 1);
    const paste = pasteFailures[0].details;
    assert.equal(paste.error.diagnostic.line, 7);
    assert.equal(paste.code, "blif.cover-value");
    assert.equal(paste.retainedPreviousView, true);
    assert.ok(paste.documentId && paste.previousDocumentId && paste.documentId !== paste.previousDocumentId);
    const warning = lines.filter((row) => row.details?.code === "blif.mapping-warnings");
    assert.equal(warning.length, 1);
    assert.equal(warning[0].details.unknownCount, 1);
    assert.equal(warning[0].level, "warning");
    assert.match(await page.locator("#schematicMount").textContent(), /in_96/);
    assert.deepEqual(errors, []);
    console.log("BLIF XOR, mapped-name search, provenance, Names navigation, SVG and diagnostic JSONL passed");
  } finally { await page.close(); }
}, { root, chromium, executablePath: process.env.NGB_CHROME });
