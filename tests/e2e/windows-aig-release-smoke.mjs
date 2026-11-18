// Windows-only package smoke. Uses installed Chrome's CDP and Node built-ins;
// no package installation, browser download or network dependency is required.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { waitForBrowserTestServer } from "./browser_test_session.mjs";

assert.equal(process.platform, "win32", "This smoke test verifies the Windows package");
const root = resolve(import.meta.dirname, "../..");
const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
const packageRoot = resolve(process.env.NGB_WINDOWS_PACKAGE || join(root, `dist/NetlistGraphBuilder-v${version}-win-x64`));
const output = resolve(process.env.NGB_WINDOWS_AIG_ARTIFACT_DIR || join(root, "dc_runs/aig_windows_release"));
assert.equal((await readFile(join(packageRoot, "VERSION"), "utf8")).trim(), version);
const guides = ["README.md", "USER_GUIDE.md", "CHANGELOG.md", "docs/USER_GUIDE.md", "docs/LINUX_SINGLE_FILE_LAUNCHER.md"];
execFileSync(process.execPath, [join(root, "tools/check_docs_links.mjs"), ...guides.map((guide) => join(packageRoot, guide))], { stdio: "inherit" });
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
async function exerciseViewport(aig) {
  await evaluate('document.getElementById("fitButton").click()');
  const point = await evaluate('(()=>{const b=document.getElementById("canvas").getBoundingClientRect();return {x:b.x+5,y:b.y+5}})()');
  const transform = () => evaluate('document.querySelector("#schematicContent").getAttribute("transform")');
  const before = await transform();
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x + 35, y: point.y + 20, buttons: 1 });
  await waitFor('document.getElementById("canvas").classList.contains("is-panning")');
  if (aig) assert.ok(await evaluate('[...document.querySelectorAll(".aig-node-label")].some(e=>getComputedStyle(e).display==="none")'));
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x + 35, y: point.y + 20, button: "left", buttons: 0, clickCount: 1 });
  await waitFor('!document.getElementById("canvas").classList.contains("is-panning")');
  assert.notEqual(await transform(), before);
  if (aig) assert.ok(await evaluate('[...document.querySelectorAll(".aig-node-label")].every(e=>getComputedStyle(e).display!=="none" && getComputedStyle(e).visibility==="visible")'));
  const panned = await transform();
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: -40 });
  await waitFor(`document.querySelector("#schematicContent").getAttribute("transform") !== ${JSON.stringify(panned)}`);
  await waitFor('!document.getElementById("canvas").classList.contains("is-view-interacting")');
  if (aig) assert.ok(await evaluate('[...document.querySelectorAll(".aig-node-label")].every(e=>getComputedStyle(e).display!=="none" && getComputedStyle(e).visibility==="visible")'));
  else {
    const node = await evaluate('(()=>{const n=document.querySelector(".node[data-kind=cell]"),b=n.querySelector(".node-shape").getBoundingClientRect();return {id:n.dataset.nodeId,x:b.x+b.width/2,y:b.y+b.height/2}})()');
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: node.x, y: node.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
    await waitFor(`document.querySelector('.node.is-selected')?.dataset.nodeId === ${JSON.stringify(node.id)}`);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".node.is-selected .node-selection-outline")).visibility'), "visible");
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".node.is-selected .node-selection-outline")).pointerEvents'), "stroke");
  }
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
  assert.equal(await evaluate('document.querySelector("[data-domain-policy=viewStyle]").value'), "abc");
  assert.equal(await evaluate('document.querySelector("#aigConnectionHighlight").value'), "all");
  await evaluate(`document.querySelector('[data-aig-node][aria-label^="and:"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    const search = document.getElementById('searchInput'); search.value = 'shared'; search.dispatchEvent(new Event('input', {bubbles:true}));
    const style = document.querySelector('[data-domain-policy=viewStyle]'); style.focus(); style.value = 'standard'; style.dispatchEvent(new Event('change', {bubbles:true}));`);
  await waitFor('document.querySelector("#statusBar").textContent === "AIG view: Standard"');
  assert.equal(await evaluate('document.getElementById("searchInput").value'), "shared");
  assert.equal(await evaluate('document.activeElement.dataset.domainPolicy'), "viewStyle");
  assert.ok(await evaluate('document.querySelectorAll("[data-neighbor-role=input]").length') > 0);
  assert.ok(await evaluate('document.querySelectorAll("[data-neighbor-role=output]").length') > 0);
  assert.equal(await evaluate('document.querySelector("[data-aig-node] text").getAttribute("font-family")'), "Arial");
  await exerciseViewport(true);
  for (const id of ['fileInput', 'aigFileInput']) {
    assert.ok((await evaluate(`document.getElementById('${id}').accept`)).split(',').includes('.blif'));
  }
  await openFile('#fileInput', 'tests/fixtures/aig/shared_cone.blif');
  await waitFor('document.querySelector("#statusBar").textContent.includes("Loaded shared_cone.blif")');
  const pasteSource = await readFile(process.env.NGB_AIG_SAMPLE || join(root, 'tests/fixtures/aig/shared_cone.blif'), 'utf8');
  await evaluate(`document.getElementById('pasteAigButton').click();
    document.getElementById('netlistTextInput').value = ${JSON.stringify(pasteSource)};
    document.getElementById('netlistTextForm').requestSubmit()`);
  await waitFor('document.querySelector("#statusBar").textContent.includes("Loaded pasted AIG") && !document.getElementById("netlistTextDialog").open');
  assert.ok(await evaluate('document.querySelectorAll("[data-aig-node]").length') > 0);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, "windows-package-aig.png"), Buffer.from(data, "base64"));
  await evaluate('document.getElementById("aigSearchFirstInput").checked = true');
  await openFile("#aigFileInput", join(packageRoot, "examples/aig_mapped_names.blif"));
  await waitFor('document.getElementById("statusBar").textContent.includes("Loaded aig_mapped_names.blif")');
  await waitFor('document.querySelector("#schematicMount .search-first-empty")');
  await evaluate('document.getElementById("wholeViewButton").click()');
  await waitFor('document.querySelector("#schematicMount [data-aig-node]")');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(\'#schematicMount [aria-label^="po:"] .aig-node-label\')].map(n => n.textContent).sort()'), ["n3", "n4"]);
  await evaluate('document.querySelector("[data-aig-nav-tab=analysis]").click()');
  await waitFor('document.querySelector("[data-aig-analysis-status=complete]") && document.querySelector("[data-aig-analysis-select]")');
  await evaluate('{ const search = document.getElementById("searchInput"); search.value = "in_96"; search.dispatchEvent(new Event("input",{bubbles:true})); }');
  await waitFor('document.querySelector("#searchResults .search-result-main")?.textContent.includes("in_96")');
  await evaluate('document.querySelector("#searchResults .search-result-main").click(); document.getElementById("focusedViewButton").click()');
  await waitFor('!document.getElementById("focusedToolbar").hidden && document.getElementById("cancelDomainImportButton").hidden');
  await evaluate('document.getElementById("faninDepthInput").value = "0"; const field = document.getElementById("fanoutDepthInput"); field.value = "0"; field.dispatchEvent(new Event("change",{bubbles:true}))');
  await waitFor('JSON.parse(sessionStorage.getItem("ngb.domain-workspace.v1")).focus.fanoutDepth === 0');
  await evaluate('document.querySelector("[data-aig-nav-tab=analysis]").click()');
  await waitFor('document.querySelector("[data-aig-analysis-status=complete]") && document.querySelector("[data-aig-analysis-category=reconvergence]")?.textContent === "Reconvergence (0)"');
  assert.ok(await evaluate('[...document.querySelectorAll("[data-aig-node]")].some(n => n.dataset.aigNode.startsWith("cut:"))'));
  await evaluate('document.getElementById("showPathMenu").open = true');
  for (const [term, kind, role] of [["in_96", "pi", "starts"], ["n4", "po", "ends"]]) {
    await evaluate(`{const field=document.getElementById("pathFind");field.value=${JSON.stringify(term)};field.dispatchEvent(new Event("input",{bubbles:true}));}`);
    await evaluate(`[...document.querySelectorAll("#pathCandidates .path-row")].find(el=>el.textContent.includes("· ${kind}")).querySelector('[data-path-action="${role}"]').click()`);
  }
  await evaluate('document.querySelector("[data-path-action=apply]").click()');
  await waitFor('document.querySelector("#showPathMenu[data-enabled]") && document.getElementById("pathReportBody").textContent.includes("To selected end 2 · From start 0")');
  await evaluate('document.querySelector("[data-path-action=tab-ends]").click()');
  await waitFor('document.querySelector("#pathReportBody .path-row").innerText.includes("To selected end 0 · From start 2") && document.querySelector("#pathReportBody .path-row").innerText.includes("outside Focused")');
  await openFile("#fileInput", "examples/two_equivalent_style_modules.v");
  await waitFor('document.querySelector("#domainToolbar").hidden && document.querySelector("#schematicMount [data-node-id]")');
  await exerciseViewport(false);
  await openFile("#fileInput", "tests/fixtures/tc_unit_generic.v");
  await waitFor('[...document.querySelectorAll("#schematicMount .gate-kind")].some(e => e.textContent === "ADFFR_PN")');
  await evaluate('document.querySelector("[data-nav-tab=analysis]").click()');
  await waitFor('document.querySelector("#netlistAnalysis [data-recon-status=complete], #netlistAnalysis [data-recon-status=partial]")');
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  const report = { packageRoot, checks: ["Package version and offline guide links", "Windows executable startup", "Netlist startup", "BLIF real WASM", "DOT same geometry", "Standard/Logic View switch and default neighbor highlighting", "Style switch retains search and keyboard focus", "AIG and Netlist real pointer pan and wheel", "AIG gesture labels restore", "BLIF file filters and generic picker", "AIG paste real WASM", "Indexed AIG import, explicit Whole and short BLIF port labels", "Packaged mapped OR/XOR and design-name search", "Focused cut removes Whole reconvergence", "Selected-end distances outside the Focused canvas", "Netlist restoration", "UNIT caption and Netlist reconvergence Worker", "No external requests or page errors"], errors, externalRequests };
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
