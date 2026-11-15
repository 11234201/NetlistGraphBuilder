import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { runBrowserTest } from "./browser_test_session.mjs";

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../..", import.meta.url));
const escapedLabelsSource = readFileSync(new URL("../fixtures/aig/escaped_labels.blif", import.meta.url), "utf8");
const whitespaceLabelsSource = readFileSync(new URL("../fixtures/aig/whitespace_labels.dot", import.meta.url), "utf8");
const report = await runBrowserTest(async ({ browser, url }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const externalRequests = [];
  const origin = new URL(url).origin;
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      externalRequests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  // An empty same-origin document proves this Worker does not depend on app globals.
  await page.goto(`${origin}/vendor/graphviz/manifest.json`);
  const result = await page.evaluate(async ({ escapedSource, whitespaceSource }) => {
    const { createGraphvizRuntime } = await import("/src/platform/graphviz_runtime.js");
    const { graphvizJsonToGeometry } = await import("/src/layout/graphviz_geometry.js");
    const { aigFeature } = await import("/src/domains/aig/aig_feature.js");
    const { renderSvgScene } = await import("/src/render/svg_scene_renderer.js");
    const { createStandaloneSvg } = await import("/src/render/svgExport.js");
    const runtime = createGraphvizRuntime();
    const started = performance.now();
    const dot = 'digraph{rankdir=BT;a[shape=triangle,label="输入 名称"];b[shape=ellipse];c[shape=invtriangle,label="out <&>"];a->b[id=e0];a->b[id=e1,style=dashed];b->c[id=e2]}';
    const json = await runtime.render(dot);
    const coldMs = performance.now() - started;
    const geometry = graphvizJsonToGeometry(json);
    const warmStart = performance.now();
    const warm = await runtime.render(dot);
    const warmMs = performance.now() - warmStart;
    const parsed = await runtime.render(dot, { format: "dot_json" });
    const escaped = aigFeature.importSource({ text: escapedSource, format: "blif" });
    const escapedStages = aigFeature.createWorkspaceStages({ layout: runtime });
    const escapedGeometry = await escapedStages.layout(escapedStages.project(escaped.model), { document: escaped });
    const escapedSvg = renderSvgScene(escapedStages.createScene(escapedGeometry, { document: escaped }));
    const svgDocument = new DOMParser().parseFromString(escapedSvg, "image/svg+xml");
    const escapedLabels = escaped.model.model.nodes.map((node) => ({ expected: node.label,
      actual: [...svgDocument.querySelector(`[data-aig-node="${node.id}"]`).querySelectorAll("text")].map((label) => label.textContent) }));
    const spaced = aigFeature.importSource({ text: whitespaceSource, format: "abc-dot" }, { documentId: "whitespace-labels" });
    const spacedStages = aigFeature.createWorkspaceStages({ layout: runtime });
    const spacedGeometry = await spacedStages.layout(spacedStages.project(spaced.model), { document: spaced });
    const spacedSvg = renderSvgScene(spacedStages.createScene(spacedGeometry, { document: spaced }));
    const mount = document.createElement("div");
    mount.innerHTML = spacedSvg;
    document.body.append(mount);
    const exported = new DOMParser().parseFromString(createStandaloneSvg(spacedSvg), "image/svg+xml");
    const exportMount = document.importNode(exported.documentElement, true);
    document.body.append(exportMount);
    const readLabel = (host, id) => {
      const label = host.querySelector(`[data-aig-node="${id}"] text`);
      return { text: label.textContent, characters: label.getNumberOfChars() };
    };
    const whitespaceLabels = spaced.model.model.nodes.map((node) => ({ expected: node.label,
      rendered: readLabel(mount, node.id), exported: readLabel(exportMount, node.id) }));
    mount.remove(); exportMount.remove();
    let invalidError;
    try { await runtime.render("digraph { broken -> }"); } catch (error) { invalidError = error.message; }
    const signal = new AbortController();
    const cancelled = runtime.render(dot, { signal: signal.signal }).catch((error) => error.name);
    signal.abort();
    const cancellation = await cancelled;
    const recovered = await runtime.render(dot);
    runtime.dispose();
    const timeoutRuntime = createGraphvizRuntime({ timeoutMs: 1 });
    let timeout;
    try { await timeoutRuntime.render(dot); } catch (error) { timeout = error.name; }
    timeoutRuntime.dispose();
    return { coldMs, warmMs, geometry, stable: JSON.stringify(json) === JSON.stringify(warm),
      recoveryStable: JSON.stringify(json) === JSON.stringify(recovered), parsedEdges: parsed.edges.length,
      invalidError, cancellation, timeout, escapedLabels, whitespaceLabels };
  }, { escapedSource: escapedLabelsSource, whitespaceSource: whitespaceLabelsSource });
  assert.equal(result.geometry.nodes.length, 3);
  assert.equal(result.geometry.edges.length, 3);
  assert.equal(result.geometry.nodes[0].labels[0].text, "输入 名称");
  assert.notEqual(result.geometry.edges[0].paths[0], result.geometry.edges[1].paths[0]);
  assert.equal(result.stable, true);
  assert.equal(result.recoveryStable, true);
  assert.equal(result.parsedEdges, 3);
  assert.match(result.invalidError, /syntax error/);
  assert.equal(result.cancellation, "AbortError");
  assert.equal(result.timeout, "TimeoutError");
  for (const label of result.escapedLabels) assert.deepEqual(label.actual, [label.expected], label.expected);
  for (const label of result.whitespaceLabels) {
    const expected = { text: label.expected, characters: label.expected.length };
    assert.deepEqual(label.rendered, expected, `Canvas label ${JSON.stringify(label.expected)}`);
    assert.deepEqual(label.exported, expected, `Export label ${JSON.stringify(label.expected)}`);
  }
  assert.deepEqual(externalRequests, []);
  return { coldMs: result.coldMs, warmMs: result.warmMs, checks: 12,
    escapedLabels: result.escapedLabels.length, whitespaceLabels: result.whitespaceLabels.length, externalRequests };
}, { root, chromium, executablePath: process.env.NGB_CHROMIUM_PATH,
  ...(process.env.NGB_GRAPHVIZ_NATIVE_BINARY ? { createServer: () => spawn(process.env.NGB_GRAPHVIZ_NATIVE_BINARY,
    ["start", "--no-open", "--port", "0"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }) } : {}) });
console.log(JSON.stringify(report, null, 2));
