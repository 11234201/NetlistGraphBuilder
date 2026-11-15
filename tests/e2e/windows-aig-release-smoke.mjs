// Windows-only package smoke. Uses installed Chrome's CDP and Node built-ins;
// no package installation, browser download or network dependency is required.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { waitForBrowserTestServer } from "./browser_test_session.mjs";

assert.equal(process.platform, "win32", "This smoke test verifies the Windows package");
const root = resolve(import.meta.dirname, "../..");
const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
const packageRoot = resolve(process.env.NGB_WINDOWS_PACKAGE || join(root, `dist/NetlistGraphBuilder-v${version}-win-x64`));
const output = resolve(root, "dc_runs/aig_windows_release");
const profile = join(output, "chrome_profile");
await mkdir(output, { recursive: true });
const port = await new Promise((done) => {
  const probe = createServer(); probe.listen(0, "127.0.0.1", () => { const value = probe.address().port; probe.close(() => done(value)); });
});
const server = spawn(join(packageRoot, "NetlistGraphBuilder.exe"), ["--no-browser", "--port", String(port)],
  { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let browser, socket, sessionId, sequence = 0;
const pending = new Map();
const errors = [], externalRequests = [];
let browserStderr = "";
let url;
const send = (method, params = {}, session = sessionId) => new Promise((resolveCall, reject) => {
  const id = ++sequence;
  const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 30000);
  pending.set(id, { resolve: (value) => { clearTimeout(timeout); resolveCall(value); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
  socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
async function waitFor(expression) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out: ${expression}; status=${await evaluate('document.querySelector("#statusBar")?.textContent')}`);
}
async function openFile(selector, file) {
  const { root: dom } = await send("DOM.getDocument");
  const { nodeId } = await send("DOM.querySelector", { nodeId: dom.nodeId, selector });
  await send("DOM.setFileInputFiles", { nodeId, files: [resolve(root, file)] });
}
try {
  url = await waitForBrowserTestServer(server);
  browser = spawn(process.env.NGB_CHROMIUM_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome startup timed out: ${browserStderr}`)), 15000);
    browser.on("error", (error) => { clearTimeout(timer); reject(error); });
    browser.stderr.on("data", (chunk) => {
      browserStderr += chunk;
      const match = browserStderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolveEndpoint(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((connected, reject) => { socket.addEventListener("open", connected, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", ({ data }) => {
    const event = JSON.parse(data);
    if (event.id) {
      const call = pending.get(event.id); pending.delete(event.id);
      if (event.error) call?.reject(new Error(JSON.stringify(event.error))); else call?.resolve(event.result);
    } else if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails);
    else if (event.method === "Network.requestWillBeSent") {
      const requestUrl = event.params.request.url;
      if (/^https?:/.test(requestUrl) && new URL(requestUrl).origin !== new URL(url).origin) externalRequests.push(requestUrl);
    }
  });
  const target = await send("Target.createTarget", { url: "about:blank" }, null);
  ({ sessionId } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, null));
  await send("Runtime.enable"); await send("Network.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  await waitFor('document.querySelector("#schematicMount [data-node-id]") && document.querySelector("#statusBar").textContent.includes("Loaded")');
  const snapshots = [];
  for (const [extension, format] of [["blif", "BLIF"], ["dot", "DOT"]]) {
    await openFile("#aigFileInput", `tests/fixtures/aig/shared_cone.${extension}`);
    await waitFor(`document.querySelector("#statusBar").textContent.includes("Loaded shared_cone.${extension}")`);
    snapshots.push(await evaluate('JSON.stringify([...document.querySelectorAll(".aig-node-shape,.aig-edge-path")].map(e=>[e.tagName,...["d","cx","cy","rx","ry","points"].map(a=>e.getAttribute(a))]))'));
    assert.equal(await evaluate('document.querySelectorAll("[data-aig-node]").length'), 15, format);
    assert.equal(await evaluate('document.querySelectorAll("[data-aig-edge]").length'), 19, format);
  }
  assert.equal(snapshots[0], snapshots[1]);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, "windows-package-aig.png"), Buffer.from(data, "base64"));
  await openFile("#fileInput", "examples/two_equivalent_style_modules.v");
  await waitFor('document.querySelector("#domainToolbar").hidden && document.querySelector("#schematicMount [data-node-id]")');
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  const report = { packageRoot, checks: ["Windows executable startup", "Netlist startup", "BLIF real WASM", "DOT same geometry", "Netlist restoration", "No external requests or page errors"], errors, externalRequests };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await send("Browser.close", {}, null); } catch { /* process cleanup below */ }
    socket.close();
  }
  for (const process of [browser, server]) if (process && process.exitCode === null) {
    const exited = new Promise((done) => process.once("exit", done));
    process.kill();
    await Promise.race([exited, new Promise((done) => setTimeout(done, 3000))]);
  }
  assert.ok(profile.startsWith(output + "/") || profile.startsWith(output + "\\"));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
}
