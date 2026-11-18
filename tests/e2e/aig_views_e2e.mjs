import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserTest } from "./browser_test_session.mjs";
import { importAigSource } from "../../src/domains/aig/aig_import.js";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const artifacts = join(root, "dc_runs/aig_views_browser");
await mkdir(artifacts, { recursive: true });
const text = await readFile(new URL("../fixtures/aig/shared_cone.blif", import.meta.url), "utf8");
const { model } = importAigSource(text, { name: "views.blif" });
const gate = (sourceId) => model.nodes.find((node) => node.kind === "and" && node.sourceRefs.some((ref) => ref.id === sourceId));
const and = gate("new_n10");
function andTrace(depth) {
  const inputs = [and.id, ...(depth >= 2 ? [gate("new_n8").id, gate("new_n9").id] : [])];
  const outputs = [and.id];
  if (depth >= 2) outputs.push(gate("new_n12").id);
  if (depth >= 3) outputs.push(gate("y").id);
  const expected = {};
  for (const edge of model.edges) {
    if (inputs.includes(edge.target)) { expected[edge.id] = "input"; expected[edge.source] = "input"; }
    if (outputs.includes(edge.source)) { expected[edge.id] = "output"; expected[edge.target] = "output"; }
  }
  return expected;
}
const expected = andTrace(Infinity);
const outsideAnd = (roles) => [...model.nodes, ...model.edges].map((object) => object.id)
  .filter((id) => id !== and.id && !Object.hasOwn(roles, id)).sort();
const roles = (page) => page.locator("[data-aig-object][data-neighbor-role]").evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
  if (![...element.querySelectorAll(".aig-neighbor-halo")].every((halo) => halo.getAttribute("visibility") === "visible")) throw new Error("Invisible neighbor");
  return [element.dataset.aigObject, element.dataset.neighborRole];
})));
const geometry = (page) => page.locator("#schematicMount").evaluate((mount) => [...mount.querySelectorAll(".aig-node-shape,.aig-edge-path")].map((shape) => ({
  id: shape.parentElement.dataset.aigObject,
  geometry: ["d", "points", "cx", "cy", "rx", "ry"].map((key) => shape.getAttribute(key))
})));
const appearance = (page) => page.locator("#schematicMount").evaluate((mount) => [...mount.querySelectorAll(".aig-node-shape,.aig-edge-path,.aig-edge-arrow,.aig-node-label")]
  .map((shape) => [shape.parentElement.dataset.aigObject, shape.tagName, shape.getAttribute("class"),
    ...["fill", "stroke", "stroke-width", "stroke-dasharray", "font-family", "font-size"].map((key) => shape.getAttribute(key))])
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
const archive = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("ngb.domain-workspace.v1")));
const greyObjects = (page) => page.locator("[data-aig-object]").evaluateAll((groups) => groups.filter((group) => {
  const { filter, opacity } = getComputedStyle(group);
  if (filter === "none" && Number(opacity) === 1) return false;
  if (filter !== "grayscale(1)" || Number(opacity) >= 1) throw new Error(`Unexpected trace style on ${group.dataset.aigObject}: ${filter}, ${opacity}`);
  return true;
}).map((group) => group.dataset.aigObject).sort());
const calls = (page) => page.evaluate(() => window.__viewTest.calls);
const cases = [];

await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__viewTest = { calls: 0, hold: false, fail: false };
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, { construct(target, args) {
      const worker = Reflect.construct(target, args);
      if (String(args[0]).includes("graphviz_worker.js")) {
        const send = worker.postMessage.bind(worker);
        worker.postMessage = (...values) => {
          window.__viewTest.calls++;
          if (window.__viewTest.fail) throw new Error("Test layout failure");
          if (window.__viewTest.hold) { window.__viewTest.release = () => send(...values); return; }
          return send(...values);
        };
      }
      return worker;
    } });
  });
  try {
    await page.goto(url);
    await page.locator("#aigFileInput").setInputFiles({ name: "views.blif", mimeType: "text/plain", buffer: Buffer.from(text) });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded views.blif"));
    const style = page.locator('[data-domain-policy="viewStyle"]');
    const highlight = page.getByRole("combobox", { name: "Highlight connections" });
    const custom = page.getByRole("spinbutton", { name: "Custom highlight levels" });
    assert.equal(await style.inputValue(), "abc");
    assert.equal(await highlight.inputValue(), "all");
    assert.equal(await custom.isVisible(), false);
    assert.equal(await style.locator('option[value="abc"]').textContent(), "Logic View");
    assert.equal(await page.locator('[data-domain-policy="critical"]').isChecked(), false);
    assert.equal(await page.locator('[data-domain-policy="fanout"]').isChecked(), false);
    const beforeGeometry = await geometry(page);
    const beforeAppearance = await appearance(page);
    const beforeCalls = await calls(page);
    await page.evaluate(() => { window.__oldAigSvg = document.querySelector("#schematicMount svg"); });
    const selectedGate = page.locator(`[data-aig-node="${and.id}"]`);
    await selectedGate.dispatchEvent("click", { detail: 0 });
    assert.equal((await archive(page)).selectedId, and.id, "non-pointer activation selects the gate");
    assert.deepEqual(await roles(page), expected);
    assert.deepEqual(await greyObjects(page), outsideAnd(expected));
    const invertedEdge = model.edges.find((edge) => edge.inverted && expected[edge.id]);
    const edgeGroup = page.locator(`[data-aig-edge="${invertedEdge.id}"]`);
    const dash = (halo) => edgeGroup.locator(halo).first().evaluate((path) => getComputedStyle(path).strokeDasharray);
    assert.equal(await dash(".aig-neighbor-halo"), await dash(".aig-edge-path"));
    await edgeGroup.dispatchEvent("click", { detail: 0 });
    assert.equal((await archive(page)).selectedId, invertedEdge.id);
    assert.equal(await dash(".aig-selection-halo"), await dash(".aig-edge-path"));
    assert.equal(await dash(".aig-edge-hit"), "none");
    cases.push("non-pointer activation selects gates and wires; highlighted inverted edges retain their gaps");
    await page.locator(`[data-aig-node="${and.id}"]`).click();
    assert.deepEqual(await roles(page), expected);
    assert.deepEqual(await greyObjects(page), outsideAnd(expected));
    await page.evaluate(() => {
      window.__unrelatedStyleWrites = 0;
      window.__styleObserver = new MutationObserver((records) => {
        window.__unrelatedStyleWrites += records.filter((record) => record.target.matches(".aig-node-shape,.aig-edge-path,.aig-edge-arrow")).length;
      });
      window.__styleObserver.observe(document.querySelector("#schematicMount"), { attributes: true, subtree: true });
    });
    for (const depth of [1, 2]) {
      await highlight.selectOption(String(depth));
      assert.deepEqual(await roles(page), andTrace(depth));
      assert.deepEqual(await greyObjects(page), outsideAnd(andTrace(depth)));
    }
    await highlight.selectOption("custom");
    await custom.fill("");
    await custom.pressSequentially("1.5");
    await custom.press("Enter");
    assert.equal(await highlight.inputValue(), "2", "an invalid entry must not commit its valid prefix");
    assert.deepEqual(await roles(page), andTrace(2));
    await highlight.selectOption("custom");
    await custom.fill("1");
    assert.deepEqual(await roles(page), andTrace(1), "preview applies immediately");
    assert.equal((await archive(page)).presentationPolicy.connectionHighlight, 2, "typing must not persist the draft");
    await custom.press("Escape");
    assert.equal(await highlight.inputValue(), "2");
    assert.deepEqual(await greyObjects(page), outsideAnd(andTrace(2)));
    await highlight.selectOption("custom");
    await custom.fill("1");
    await custom.press("Tab");
    assert.equal(await highlight.inputValue(), "1");
    assert.equal((await archive(page)).presentationPolicy.connectionHighlight, 1, "leaving a valid entry commits it");
    await highlight.selectOption("2");
    await page.screenshot({ path: join(artifacts, "logic-and-two-levels.png") });
    await highlight.selectOption("off");
    assert.deepEqual(await roles(page), {});
    assert.deepEqual(await greyObjects(page), []);
    await highlight.selectOption("all");
    assert.deepEqual(await roles(page), expected);
    assert.equal(await page.evaluate(() => {
      window.__styleObserver.disconnect(); return window.__unrelatedStyleWrites;
    }), 0, "the neighbor toggle cannot rewrite unrelated base shapes or edges");
    assert.equal(await calls(page), beforeCalls);
    assert.equal(await page.evaluate(() => window.__oldAigSvg === document.querySelector("#schematicMount svg")), true);
    assert.deepEqual(await geometry(page), beforeGeometry);
    cases.push("AND selections trace blue fanin and green fanout to the same depth and dim the complement without layout");

    await page.evaluate(() => { window.__viewTest.hold = true; window.__viewTest.release = null; });
    await style.focus();
    await style.selectOption("standard");
    await page.waitForFunction(() => Boolean(window.__viewTest.release));
    assert.equal(await style.isEnabled(), true, "the view selector stays usable during a layout");
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.domainPolicy), "viewStyle");
    await style.selectOption("abc");
    assert.equal(await style.inputValue(), "abc");
    assert.equal(await page.locator("#cancelDomainImportButton").evaluate((button) => button.hidden), true);
    await page.evaluate(() => { window.__viewTest.release(); });
    assert.deepEqual(await geometry(page), beforeGeometry);
    assert.deepEqual(await roles(page), expected);
    cases.push("choosing the active style cancels a pending layout without losing keyboard focus");

    await page.evaluate(() => { window.__viewTest.hold = true; window.__viewTest.release = null; });
    await style.selectOption("standard");
    await page.waitForFunction(() => Boolean(window.__viewTest.release));
    for (const menu of await page.locator("#cancelDomainImportButton").locator("xpath=ancestor::details").all()) {
      if (!await menu.evaluate((element) => element.open)) await menu.locator(":scope > summary").click();
    }
    await page.locator("#cancelDomainImportButton").click();
    assert.equal(await style.inputValue(), "abc");
    assert.deepEqual(await geometry(page), beforeGeometry);
    assert.equal((await archive(page)).presentationPolicy.viewStyle, "abc");
    await page.evaluate(() => { window.__viewTest.hold = false; window.__viewTest.release(); window.__viewTest.fail = true; });
    await style.selectOption("standard");
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Test layout failure"));
    assert.equal(await style.inputValue(), "abc");
    assert.deepEqual(await roles(page), expected);
    assert.deepEqual(await geometry(page), beforeGeometry);
    await page.evaluate(() => { window.__viewTest.fail = false; });
    cases.push("cancelled and failed style changes keep the old graph, policy and selection");

    const switchStyle = async (value) => {
      await style.focus();
      await style.selectOption(value);
      await page.waitForFunction((value) => document.querySelector("#statusBar").textContent === `AIG view: ${value === "abc" ? "Logic View" : "Standard"}`, value);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.domainPolicy), "viewStyle", "keyboard focus survives the view commit");
    };
    await page.locator("#searchInput").fill("shared");
    await page.locator("#searchResults [data-search-index]").first().waitFor();
    await page.evaluate(() => {
      window.__styleControl = document.querySelector('[data-domain-policy="viewStyle"]');
      window.__viewTest.hold = true; window.__viewTest.release = null;
    });
    await style.selectOption("standard");
    await page.waitForFunction(() => Boolean(window.__viewTest.release));
    await page.locator(`[data-aig-node="${and.id}"]`).press("Enter");
    await page.evaluate(() => { window.__viewTest.hold = false; window.__viewTest.release(); });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent === "AIG view: Standard");
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.domainObject), and.id,
      "a node focused while layout is pending keeps keyboard focus in the new SVG");
    assert.equal(await page.locator("#searchInput").inputValue(), "shared");
    assert.equal(await page.evaluate(() => window.__styleControl === document.querySelector('[data-domain-policy="viewStyle"]')), true);
    const standardGeometry = await geometry(page);
    assert.notDeepEqual(standardGeometry, beforeGeometry);
    assert.deepEqual(standardGeometry.map((item) => item.id).sort(), beforeGeometry.map((item) => item.id).sort());
    assert.deepEqual(await roles(page), expected);
    assert.equal((await archive(page)).selectedId, and.id);
    assert.equal(await page.locator("[data-aig-node] text").first().getAttribute("font-family"), "Arial");
    assert.ok(await page.locator('.aig-edge-path[stroke-dasharray="5 4"]').count() > 0);
    assert.deepEqual(await appearance(page), beforeAppearance);
    await page.screenshot({ path: join(artifacts, "standard-selected.png") });
    const afterStandard = await calls(page);
    await switchStyle("abc");
    assert.deepEqual(await geometry(page), beforeGeometry);
    await page.screenshot({ path: join(artifacts, "logic-selected.png") });
    await switchStyle("standard");
    assert.equal(await calls(page), afterStandard, "round trips use both cached layouts");
    assert.equal(await page.locator("#searchInput").inputValue(), "shared");
    cases.push("Switching to Standard changes layout while preserving colors, fonts, line styles, identities and selection, and caches round trips");

    await highlight.selectOption("custom");
    await custom.fill("2");
    await custom.press("Enter");
    assert.deepEqual(await roles(page), andTrace(2));
    assert.deepEqual(await greyObjects(page), outsideAnd(andTrace(2)));
    const downloaded = page.waitForEvent("download");
    const exportButton = page.locator("#exportSvgButton");
    for (const menu of await exportButton.locator("xpath=ancestor::details").all()) {
      if (!await menu.evaluate((element) => element.open)) await menu.locator(":scope > summary").click();
    }
    await exportButton.click();
    const download = await downloaded;
    const svg = await readFile(await download.path(), "utf8");
    assert.match(svg, /Arial/);
    assert.doesNotMatch(svg, /Times-Roman/);
    assert.match(svg, /data-neighbor-role="input"/);
    assert.match(svg, /data-neighbor-role="output"/);
    const exportedAnd = await browser.newPage();
    await exportedAnd.setContent(svg);
    assert.deepEqual(await roles(exportedAnd), andTrace(2));
    assert.deepEqual(await greyObjects(exportedAnd), outsideAnd(andTrace(2)));
    const invertedHighlights = exportedAnd.locator('.aig-edge[data-neighbor-role]:has(.aig-edge-path[stroke-dasharray]) .aig-neighbor-halo');
    assert.ok(await invertedHighlights.count() > 0);
    assert.ok(await invertedHighlights.evaluateAll((paths) => paths.every((path) =>
      getComputedStyle(path).strokeDasharray === getComputedStyle(path.parentElement.querySelector(".aig-edge-path")).strokeDasharray)));
    await exportedAnd.close();
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded views.blif"));
    assert.equal(await style.inputValue(), "standard");
    assert.deepEqual(await geometry(page), standardGeometry);
    assert.equal(await highlight.inputValue(), "2");
    assert.deepEqual(await roles(page), andTrace(2));
    assert.deepEqual(await greyObjects(page), outsideAnd(andTrace(2)));
    cases.push("SVG export and reload retain both bounded AND cones and their greyed complement");

    await page.locator("#canvas").click({ position: { x: 5, y: 5 } });
    assert.deepEqual(await roles(page), {});
    assert.deepEqual(await greyObjects(page), []);
    assert.equal((await archive(page)).selectedId, null);
    await page.locator("#fileInput").setInputFiles({ name: "netlist.v", mimeType: "text/plain",
      buffer: Buffer.from("module top(input a,b,output y); AND2 u1 (.A(a),.B(b),.Y(y)); endmodule") });
    await page.locator('[data-node-id="cell:u1"]').waitFor();
    assert.equal(await page.locator("#domainToolbar").isVisible(), false);
    assert.equal(await page.locator("#schematicMount .aig-neighbor-halo").count(), 0);
    assert.equal(await archive(page), null);
    cases.push("blank click clears highlights; Netlist retains its own behavior");

    const outputs = Array.from({ length: 150 }, (_, i) => `output_${i}`);
    const ports = `.model scroll\n.inputs a\n.outputs ${outputs.join(" ")}\n${outputs.map((name) => `.names a ${name}\n1 1`).join("\n")}\n.end`;
    await page.locator("#aigFileInput").setInputFiles({ name: "scroll.blif", mimeType: "text/plain", buffer: Buffer.from(ports) });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded scroll.blif"));
    await page.locator('[data-aig-nav-tab="objects"]').click();
    const scrollBefore = await page.locator("#navigatorPanel").evaluate((panel) => { panel.scrollTop = 400; return panel.scrollTop; });
    assert.ok(scrollBefore > 0, "the fixture must exercise a scrolled sidebar");
    await page.evaluate(() => { window.__retainedNavigator = document.querySelector('[data-aig-filter="query"]'); });
    await switchStyle("standard");
    assert.equal(await page.locator("#navigatorPanel").evaluate((panel) => panel.scrollTop), scrollBefore);
    assert.equal(await page.evaluate(() => window.__retainedNavigator.isConnected), true);
    cases.push("same-document layout preserves the navigator scroll position");

    await page.locator("#aigFileInput").setInputFiles({ name: "composition.blif", mimeType: "text/plain",
      buffer: Buffer.from(".model composition\n.inputs 雪\n.outputs y\n.names 雪 y\n1 1\n.end") });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded composition.blif"));
    await page.locator('[data-aig-nav-tab="objects"]').click();
    await page.evaluate(() => { window.__viewTest.hold = true; window.__viewTest.release = null; });
    await style.selectOption("standard");
    await page.waitForFunction(() => Boolean(window.__viewTest.release));
    const query = page.locator('[data-aig-filter="query"]');
    await query.focus();
    await query.evaluate((input) => { window.__composingInput = input; });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "雪", selectionStart: 1, selectionEnd: 1 });
    await page.evaluate(() => { window.__viewTest.hold = false; window.__viewTest.release(); });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent === "AIG view: Standard");
    assert.equal(await page.evaluate(() => window.__composingInput.isConnected), true,
      "a completed layout cannot replace the input during an IME composition");
    assert.equal(await page.evaluate(() => document.activeElement === window.__composingInput), true);
    await cdp.send("Input.insertText", { text: "雪" });
    assert.equal(await query.inputValue(), "雪");
    assert.equal((await archive(page)).panels.navigator.query, "雪");
    assert.match(await page.locator("#domainNavigator").innerText(), /1 objects/);
    cases.push("layout completion preserves an in-progress IME composition and its final filter");
    await query.focus();
    await cdp.send("Input.imeSetComposition", { text: "旧", selectionStart: 1, selectionEnd: 1 });

    const coneSource = ".model port_cones\n.inputs a b c\n.outputs y direct\n.names a b first\n11 1\n.names first c y\n10 1\n.names a direct\n0 1\n.end";
    const cone = importAigSource(coneSource).model;
    const port = (kind, label) => cone.nodes.find((node) => node.kind === kind && node.label === label);
    const a = port("pi", "a"), y = port("po", "y"), direct = port("po", "direct");
    const inputNodes = cone.nodes.filter((node) => node.kind === "and" || node.kind === "po");
    const inputEdges = cone.edges.filter((edge) => ![port("pi", "b").id, port("pi", "c").id].includes(edge.source));
    const outputNodes = cone.nodes.filter((node) => node.kind === "pi" || node.kind === "and");
    const outputEdges = cone.edges.filter((edge) => edge.target !== direct.id);
    const outside = (selected, members) => {
      const visible = new Set([selected, ...members].map((object) => object.id));
      return [...cone.nodes, ...cone.edges].map((object) => object.id).filter((id) => !visible.has(id)).sort();
    };
    const outsideInput = outside(a, [...inputNodes, ...inputEdges]);
    const outsideOutput = outside(y, [...outputNodes, ...outputEdges]);
    const inputDirectEdges = cone.edges.filter((edge) => edge.source === a.id);
    const inputOne = [...inputDirectEdges, ...inputDirectEdges.map((edge) => cone.nodes.find((node) => node.id === edge.target))];
    const driverEdge = cone.edges.find((edge) => edge.target === y.id);
    const driver = cone.nodes.find((node) => node.id === driverEdge.source);
    const faninEdges = cone.edges.filter((edge) => edge.target === driver.id);
    const outputTwo = [driverEdge, driver, ...faninEdges, ...faninEdges.map((edge) => cone.nodes.find((node) => node.id === edge.source))];
    const checkTrace = async (selected, members, role) => {
      assert.deepEqual(await roles(page), Object.fromEntries(members.map((object) => [object.id, role])));
      assert.deepEqual(await greyObjects(page), outside(selected, members));
    };
    await page.locator("#aigFileInput").setInputFiles({ name: "port_cones.blif", mimeType: "text/plain", buffer: Buffer.from(coneSource) });
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded port_cones.blif"));
    assert.equal(await page.locator('[data-aig-nav-content="design"]').count(), 1, "document replacement must release the previous composing filter");
    assert.match(await page.locator("#domainNavigator").innerText(), /port_cones\.blif/);
    assert.equal((await archive(page)).panels.navigator.query, "");
    await cdp.detach();
    for (const value of ["abc", "standard"]) {
      if (value === "standard") await switchStyle(value);
      const geometryBeforeClick = await geometry(page), layoutCalls = await calls(page);
      await page.evaluate(() => { window.__coneSvg = document.querySelector("#schematicMount svg"); });
      await page.locator(`[data-aig-node="${a.id}"]`).click();
      assert.deepEqual(await roles(page), Object.fromEntries([...inputNodes, ...inputEdges].map((object) => [object.id, "output"])));
      assert.deepEqual(await greyObjects(page), outsideInput);
      await highlight.selectOption("1");
      await checkTrace(a, inputOne, "output");
      await page.locator(`[data-aig-node="${y.id}"]`).click();
      await checkTrace(y, [driverEdge, driver], "input");
      await highlight.selectOption("2");
      await checkTrace(y, outputTwo, "input");
      await highlight.selectOption("custom");
      assert.equal(await highlight.isVisible(), false);
      await custom.fill("0");
      await custom.press("Enter");
      assert.equal(await highlight.inputValue(), "2");
      await checkTrace(y, outputTwo, "input");
      await highlight.selectOption("custom");
      await custom.fill("17");
      await custom.press("Enter");
      assert.equal(await highlight.inputValue(), "17");
      assert.equal(await highlight.locator("option:checked").textContent(), "17 levels");
      assert.deepEqual(await roles(page), Object.fromEntries([...outputNodes, ...outputEdges].map((object) => [object.id, "input"])));
      assert.deepEqual(await greyObjects(page), outsideOutput);
      await highlight.selectOption("off");
      assert.deepEqual(await roles(page), {});
      assert.deepEqual(await greyObjects(page), []);
      await highlight.selectOption("all");
      assert.equal(Object.keys(await roles(page)).length, 10);
      assert.deepEqual(await greyObjects(page), outsideOutput);
      assert.equal(await calls(page), layoutCalls);
      assert.deepEqual(await geometry(page), geometryBeforeClick);
      assert.equal(await page.evaluate(() => window.__coneSvg === document.querySelector("#schematicMount svg")), true);
    }
    await highlight.selectOption("custom");
    await custom.fill("2");
    await checkTrace(y, outputTwo, "input");
    await custom.press("Escape");
    assert.equal(await highlight.inputValue(), "all");
    assert.deepEqual(await greyObjects(page), outsideOutput);
    await highlight.selectOption("2");
    await switchStyle("abc");
    assert.equal(await highlight.inputValue(), "2");
    await checkTrace(y, outputTwo, "input");
    await page.screenshot({ path: join(artifacts, "logic-output-cone.png") });
    const coneDownload = page.waitForEvent("download");
    for (const menu of await exportButton.locator("xpath=ancestor::details").all()) {
      if (!await menu.evaluate((element) => element.open)) await menu.locator(":scope > summary").click();
    }
    await exportButton.click();
    const exportedCone = await readFile(await (await coneDownload).path(), "utf8");
    assert.equal((exportedCone.match(/data-neighbor-role="input"/g) || []).length, outputTwo.length);
    const svgPage = await browser.newPage();
    await svgPage.setContent(exportedCone);
    assert.deepEqual(await greyObjects(svgPage), outside(y, outputTwo));
    await svgPage.close();
    await page.locator('[data-domain-policy="critical"]').check();
    await page.locator('[data-domain-policy="fanout"]').check();
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#statusBar").textContent.includes("Loaded port_cones.blif"));
    assert.equal(await page.locator('[data-domain-policy="critical"]').isChecked(), true);
    assert.equal(await page.locator('[data-domain-policy="fanout"]').isChecked(), true);
    assert.equal(await highlight.inputValue(), "2");
    await checkTrace(y, outputTwo, "input");
    await page.locator("#canvas").click({ position: { x: 5, y: 5 } });
    assert.deepEqual(await greyObjects(page), []);
    cases.push("both views support full and bounded port traces without layout, with matching greyed objects in SVG export and session restore");
    assert.deepEqual(errors, []);
    await writeFile(join(artifacts, "report.json"), JSON.stringify({ cases, errors }, null, 2));
    console.log(JSON.stringify({ cases, errors, artifacts }));
  } catch (error) {
    await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
    throw error;
  }
}, { root, chromium, executablePath: process.env.NGB_CHROME });
