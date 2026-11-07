import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const server = spawn(process.execPath, ["tools/serve.mjs", "--no-browser", "--port", "0"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"]
});
let browser;
try {
  const url = await new Promise((resolve, reject) => {
    let output = "";
    server.stdout.on("data", (chunk) => {
      output += chunk;
      for (const line of output.split("\n")) {
        try { const message = JSON.parse(line); if (message.event === "ready") resolve(message.url); } catch {}
      }
    });
    server.on("error", reject);
    server.on("exit", (code) => reject(new Error(`Server exited: ${code}`)));
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.NGB_CHROME, args: ["--no-sandbox"] });
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator("#schematicMount svg").waitFor();
  await page.locator("#pasteNetlistButton").evaluate((button) => button.click());
  const input = page.locator("#netlistTextInput");
  await input.focus();
  const source = "// NAND2_X1 instance_with_a_long_hierarchical_name (.A(long_signal_name_a), .B(long_signal_name_b), .Y(long_output_signal_name));\n".repeat(60000)
    + "module bulk_tail(input a, output y); BUF final_tail (.A(a), .Y(y)); endmodule";
  await page.evaluate((text) => navigator.clipboard.writeText(text), source);
  await page.keyboard.press("Control+v");
  assert.ok(await input.evaluate((element) => element.readOnly && element.value.length <= 8192));
  const start = performance.now();
  await page.keyboard.press("Control+a");
  const selection = await input.evaluate((element) => ({ start: element.selectionStart, end: element.selectionEnd, length: element.value.length }));
  const selectMs = performance.now() - start;
  assert.equal(selection.start, 0);
  assert.equal(selection.end, selection.length);
  await page.keyboard.press("Control+c");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
  // Import a module located beyond the preview to catch accidental truncation.
  await page.keyboard.press("Control+Enter");
  await page.locator('#schematicMount [data-node-id="cell:final_tail"]').first().waitFor();
  await page.locator("#pasteNetlistButton").evaluate((button) => button.click());
  await input.focus();
  await page.keyboard.press("Control+a");
  const replacement = "module replacement(input a, output y); BUF replacement_tail (.A(a), .Y(y)); endmodule";
  await page.evaluate((text) => navigator.clipboard.writeText(text), replacement);
  await page.keyboard.press("Control+v");
  assert.equal(await input.inputValue(), replacement);
  assert.equal(await input.evaluate((element) => element.readOnly), false);
  await page.keyboard.press("Control+Enter");
  await page.locator('#schematicMount [data-node-id="cell:replacement_tail"]').first().waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ sourceCharacters: source.length, previewCharacters: selection.length, selectMs, fullCopy: true, fullImport: true, replacementImport: true, errors }));
} finally {
  await browser?.close();
  server.kill();
}
