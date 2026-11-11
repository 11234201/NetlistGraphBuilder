import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";
const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");

await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator("#schematicMount svg").waitFor();
  const source = `module top(input clk, reset, d, output y);
    AND3X1 u (.A(clk),.B(reset),.C(d),.Y(y)); endmodule
    module peer(input clk, reset, d, output y);
    AND3X1 v (.A(clk),.B(reset),.C(d),.Y(y)); endmodule`;
  await page.locator("#fileInput").setInputFiles({ name: "routing.v", mimeType: "text/plain", buffer: Buffer.from(source) });
  await page.locator('#schematicMount [data-node-id="cell:u"]').first().waitFor();
  const net = (mount, name) => page.locator(`${mount} .edge[data-net="${name}"]`);
  const route = () => page.locator("[data-route-net]");
  const ready = (prefix = "Ready") => page.waitForFunction((prefix) => document.querySelector("#statusBar").textContent.startsWith(prefix), prefix)
    .catch(async (error) => { throw new Error(`${error.message}\nStatus: ${await page.locator("#statusBar").textContent()}\nPage errors: ${errors.join(" | ")}`); });
  const click = (selector) => page.locator(selector).first().evaluate((element) => element.click());
  const toggle = async (enabled) => {
    await route().evaluate((input, value) => { input.checked = value; input.dispatchEvent(new Event("change", { bubbles: true })); }, enabled);
  };
  await net("#schematicMount", "clk").first().dispatchEvent("pointerdown", { button: 0 });
  assert.equal(await route().isChecked(), true);
  await toggle(false);
  await ready();
  assert.equal(await net("#schematicMount", "clk").count(), 0);
  assert.ok(await net("#schematicMount", "d").count());
  assert.ok(await page.locator('#schematicMount [data-node-id="cell:u"]').count());
  await click("#moduleBackButton");
  await net("#schematicMount", "clk").first().waitFor();
  await click("#moduleForwardButton");
  await net("#schematicMount", "clk").first().waitFor({ state: "detached" });
  // Restore without any rendered clock wire by following a cell connection.
  await page.locator('#schematicMount [data-node-id="cell:u"]').first().dispatchEvent("pointerdown", { button: 0 });
  await click('[data-selection-target-kind="net"][data-selection-target-name="clk"]');
  assert.equal(await route().isChecked(), false);
  await toggle(true);
  await net("#schematicMount", "clk").first().waitFor();
  await ready();
  assert.ok(await page.locator('#schematicMount .edge.is-selected[data-net="clk"]').count());
  await toggle(false);
  await net("#schematicMount", "clk").first().waitFor({ state: "detached" });
  await ready();
  // Export consumes the same filtered scene.
  const downloaded = page.waitForEvent("download");
  await click("#exportSvgButton");
  const exported = await downloaded;
  const svg = await readFile(await exported.path(), "utf8");
  assert.doesNotMatch(svg, /data-net="clk"/);
  assert.match(svg, /data-net="d"/);
  // Single's current-module setting survives the browser session snapshot.
  await page.reload();
  await page.locator('#schematicMount [data-node-id="cell:u"]').first().waitFor();
  assert.equal(await net("#schematicMount", "clk").count(), 0);
  await click("#compareButton");
  await page.locator("#leftModuleSelect").selectOption("top");
  await page.locator("#rightModuleSelect").selectOption("peer");
  await click("#applyCompareButton");
  await net("#leftSchematicMount", "clk").first().waitFor();
  await net("#rightSchematicMount", "clk").first().waitFor();
  await net("#leftSchematicMount", "clk").first().dispatchEvent("pointerdown", { button: 0 });
  await toggle(false);
  await net("#leftSchematicMount", "clk").first().waitFor({ state: "detached" });
  await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Compare ready"));
  assert.ok(await net("#rightSchematicMount", "clk").count());
  await page.locator('#leftSchematicMount [data-node-id="cell:u"]').first().dispatchEvent("pointerdown", { button: 0 });
  await click('[data-selection-target-kind="net"][data-selection-target-name="clk"]');
  assert.equal(await route().isChecked(), false);
  await toggle(true);
  await net("#leftSchematicMount", "clk").first().waitFor();
  await click("#exitCompareButton");

  // Equal constant values are not aliases of independent named nets.
  const constants = `module constants(input d, output y, z, w);
    wire reset, scan_en; assign reset = 1'b0; assign scan_en = 1'b0;
    AND2X1 u_reset (.A(reset),.B(d),.Y(y));
    AND2X1 u_scan (.A(scan_en),.B(d),.Y(z));
    AND2X1 u_const (.A(1'b0),.B(d),.Y(w)); endmodule`;
  await page.locator("#fileInput").setInputFiles({ name: "constants.v", mimeType: "text/plain", buffer: Buffer.from(constants) });
  await net("#schematicMount", "reset").first().waitFor();
  await ready("Loaded constants.v");
  await net("#schematicMount", "reset").first().dispatchEvent("pointerdown", { button: 0 });
  await toggle(false);
  await ready();
  assert.equal(await net("#schematicMount", "reset").count(), 0);
  assert.ok(await net("#schematicMount", "scan_en").count());
  assert.ok(await net("#schematicMount", "1'b0").count());

  // A hidden net outside the current cone still needs Search/Focused reveal.
  const isolated = `module isolated(input clk, d, output y, z);
    BUFX1 u_clock (.A(clk),.Y(y)); BUFX1 u_data (.A(d),.Y(z)); endmodule`;
  await page.locator("#fileInput").setInputFiles({ name: "isolated.v", mimeType: "text/plain", buffer: Buffer.from(isolated) });
  await net("#schematicMount", "clk").first().waitFor();
  await ready("Loaded isolated.v");
  await net("#schematicMount", "clk").first().dispatchEvent("pointerdown", { button: 0 });
  await toggle(false);
  await ready();
  const focusData = async () => {
    await page.locator('#schematicMount [data-node-id="cell:u_data"]').first().dispatchEvent("pointerdown", { button: 0 });
    await click("#setFocusedRootButton");
    await page.locator('#schematicMount [data-node-id="cell:u_clock"]').waitFor({ state: "detached" });
  };
  const searchClock = async (add) => {
    await page.locator("#searchInput").fill("");
    await page.locator("#searchInput").fill("clk");
    const result = page.locator(".search-result").filter({ has: page.locator(".search-result-kind", { hasText: /^net$/ }) });
    await result.locator(add ? "[data-search-add-index]" : "[data-search-index]").evaluate((button) => button.click());
    await page.locator('#schematicMount [data-node-id="cell:u_clock"]').first().waitFor();
    assert.equal(await route().isChecked(), false);
  };
  await focusData();
  await searchClock(false);
  await toggle(true);
  await net("#schematicMount", "clk").first().waitFor();
  await ready();
  await toggle(false);
  await ready();
  await focusData();
  await searchClock(true);

  const aliasSource = `module alias_root(input clk,d,output y); wire clk_alias;
    assign clk_alias=clk; AND2X1 u(.A(clk_alias),.B(d),.Y(y)); endmodule`;
  await page.locator("#fileInput").setInputFiles({ name: "alias_root.v", mimeType: "text/plain", buffer: Buffer.from(aliasSource) });
  await ready("Loaded alias_root.v");
  await net("#schematicMount", "clk_alias").first().dispatchEvent("pointerdown", { button: 0 });
  await toggle(false);
  await ready();
  await page.locator("#searchInput").fill("clk");
  await page.locator('.search-result[title="clk"]').filter({ has: page.locator(".search-result-kind", { hasText: /^net$/ }) })
    .locator("[data-search-index]").evaluate((button) => button.click());
  await click("#setFocusedRootButton");
  await ready();
  assert.ok(await page.locator('#schematicMount [data-node-id="cell:u"]').count());
  await toggle(true);
  await ready();
  assert.ok(await net("#schematicMount", "clk_alias").count());

  const fanoutSource = `module fanout(input d, output y,z,w); wire n,n1,n2;
    BUFX1 driver(.A(d),.Y(n)); BUFX1 a(.A(n),.Y(n1)); BUFX1 b(.A(n),.Y(n2));
    BUFX1 outside(.A(n),.Y(w)); BUFX1 ra(.A(n1),.Y(y)); BUFX1 rb(.A(n2),.Y(z)); endmodule`;
  await page.locator("#fileInput").setInputFiles({ name: "fanout.v", mimeType: "text/plain", buffer: Buffer.from(fanoutSource) });
  await ready("Loaded fanout.v");
  await page.locator('#schematicMount [data-node-id="cell:ra"]').first().dispatchEvent("pointerdown", { button: 0 });
  await click("#setFocusedRootButton");
  await page.locator("#faninDepthInput").fill("1");
  await page.locator("#fanoutDepthInput").fill("1");
  await page.locator("#fanoutDepthInput").dispatchEvent("change");
  await page.locator('#schematicMount [data-node-id="cell:driver"]').waitFor({ state: "detached" });
  await page.locator("#searchInput").fill("rb");
  await page.locator('.search-result[title="rb"] [data-search-add-index]').evaluate((button) => button.click());
  await page.locator('#schematicMount [data-node-id="cell:b"]').first().waitFor();
  const boundaryId = `focus-boundary:out:${[..."cell:driver\u0000n"].map((char) => char.codePointAt(0).toString(16)).join(".")}`;
  await page.locator(`#schematicMount [data-node-id="${boundaryId}"]`).first().waitFor();
  assert.equal(await page.locator('#schematicMount [data-node-id="cell:outside"]').count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ workflow: "net-routing-single-compare-restore-export-session-constants-focused-search-alias-fanout", errors }));
}, {
  root: fileURLToPath(new URL("../..", import.meta.url)), chromium, executablePath: process.env.NGB_CHROME,
  ...(process.env.NGB_RELEASE_EXE ? { createServer: () => spawn(process.env.NGB_RELEASE_EXE,
    ["--no-browser", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }) } : {})
});
