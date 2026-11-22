import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const file = (name, text) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
const blif = ".model gates\n.inputs a b c\n.outputs y\n.names a b n\n11 1\n.names n c y\n11 1\n.end\n";
const report = "point at_level rt_level slack_level\na 3 - -\ny 9 7 -\n";

await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  const openMenu = async () => {
    const menu = page.locator("#fileMenu");
    if (!await menu.evaluate(el => el.open)) await menu.locator("summary").click();
  };
  const choose = async (id, files) => {
    await openMenu();
    const picked = page.waitForEvent("filechooser");
    await page.locator(`#fileMenu label:has(#${id})`).click();
    await (await picked).setFiles(files);
  };
  const loaded = async (name, levelName = "") => {
    await page.waitForFunction(([name, levelName]) => {
      const text = document.querySelector("#statusBar").textContent;
      return text.includes("Loaded " + name) && text.includes(levelName);
    }, [name, levelName]);
    await page.locator("#schematicMount [data-aig-node]").first().waitFor();
  };
  const rows = async selector => page.locator(selector + " dt").evaluateAll(items =>
    Object.fromEntries(items.map(item => [item.textContent, item.nextElementSibling.textContent])));
  const designStats = async () => {
    await page.locator('[data-aig-nav-tab="design"]').click();
    return rows('[data-aig-nav-content="design"]');
  };
  const outputStats = async () => {
    await page.locator('[data-aig-nav-tab="objects"]').click();
    await page.locator('#domainNavigator [data-aig-select][title="y"]').click();
    await page.locator('[data-aig-inspector-tab="analysis"]').click();
    return rows('[data-aig-inspector-content="analysis"]');
  };
  const checkReport = async () => {
    const stats = await designStats();
    assert.equal(stats["Level file"], "arrival.csv");
    assert.equal(stats["Reported points"], "2");
    assert.equal(stats["Maximum output level"], "5");
    const output = await outputStats();
    assert.equal(output["Topology level"], "5");
    assert.equal(output["Reported AT level"], "9");
    assert.equal(output["Reported RT level"], "7");
    assert.equal(output["Slack level (RT − AT)"], "-2");
  };
  const graph = page.locator("#aigGraphSelect");
  const switchGraph = async name => {
    const option = graph.locator("option").filter({ hasText: name });
    await graph.selectOption(await option.getAttribute("value"));
    await loaded(name);
  };
  try {
    await page.goto(url);
    await openMenu();
    assert.equal(await page.getByRole("group", { name: "Netlist + Timing" }).locator("#timingInput").count(), 1);
    assert.equal(await page.getByRole("group", { name: "AIG + Level" }).locator("#levelInput").count(), 1);
    await choose("fileInput", file("only.v", "module top(input a, output y); INV u_inv (.A(a), .Y(y)); endmodule"));
    await page.locator('#schematicMount [data-node-id="cell:u_inv"]').waitFor();
    await choose("fileInput", [file("netlist.timing", "point at rt slack\nu_buf/Y 3 2 -1"),
      file("paired.v", "module paired(input a, output y); BUF u_buf (.A(a), .Y(y)); endmodule")]);
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded timing netlist.timing"));
    await page.locator('#schematicMount [data-node-id="cell:u_buf"]').waitFor();
    await choose("fileInput", file("only.blif", blif));
    await loaded("only.blif");
    const original = await designStats();
    assert.equal(original["Maximum AND depth"], "2");
    assert.equal(original["Level file"], undefined);

    await choose("fileInput", [file("arrival.csv", report), file("gates.blif", blif)]);
    await loaded("gates.blif", "arrival.csv");
    await checkReport();
    const selectedId = await page.locator("[data-aig-inspected-id]").getAttribute("data-aig-inspected-id");
    const currentNodes = await page.locator("#schematicMount [data-aig-node]").count();

    await choose("levelInput", file("bad.level", "a 4\nunknown_port 9\n"));
    const failed = page.locator("#processLogList .level-error").filter({ hasText: "bad.level" });
    await failed.waitFor({ state: "attached" });
    if (!await page.locator("#processLogList").isVisible()) await page.locator("#toggleProcessLogButton").click();
    await failed.locator("summary").click();
    const details = JSON.parse(await failed.locator("pre").innerText());
    assert.equal(details.operation, "aig.level.import");
    assert.equal(details.fileName, "bad.level");
    assert.equal(details.line, 2);
    assert.equal(details.retainedPreviousView, true);
    assert.ok(details.graphId);
    assert.equal(details.error.code, "aig.level-unknown-point");
    assert.match(details.error.stack, /unknown_port/);
    const download = page.waitForEvent("download");
    await page.locator("#exportProcessLogButton").click();
    const records = (await readFile(await (await download).path(), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
    const failureRows = records.filter(row => row.level === "error" && JSON.stringify(row).includes("bad.level"));
    assert.equal(failureRows.length, 1);
    assert.deepEqual(failureRows[0].details, details);
    await page.locator("#closeProcessLogButton").click();
    assert.equal(await page.locator("[data-aig-inspected-id]").getAttribute("data-aig-inspected-id"), selectedId);
    assert.equal(await page.locator("#schematicMount [data-aig-node]").count(), currentNodes);
    await checkReport();
    await page.reload();
    await loaded("gates.blif", "arrival.csv");
    await checkReport();

    await choose("addAigInput", file("another.blif", blif));
    await graph.waitFor();
    await switchGraph("another.blif");
    assert.equal((await designStats())["Level file"], undefined);
    await openMenu();
    await page.locator("#pasteLevelButton").click();
    await page.locator("#netlistTextInput").fill("b 5");
    await page.locator("[data-text-submit]").click();
    await loaded("another.blif", "pasted Level");
    assert.equal((await designStats())["Maximum output level"], "7");
    await switchGraph("gates.blif");
    await checkReport();
    await page.reload();
    await loaded("gates.blif", "arrival.csv");
    await switchGraph("another.blif");
    assert.equal((await designStats())["Maximum output level"], "7");
    assert.deepEqual(errors, []);
    console.log("Passed main-file selection, reverse Netlist/Timing and AIG/Level pairs, report display, error details/JSONL, paste, graph switching and reload.");
  } finally { await page.close(); }
}, { root, chromium, executablePath: process.env.NGB_CHROME });
