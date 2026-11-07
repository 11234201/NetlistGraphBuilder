import assert from "node:assert/strict";
import test from "node:test";
import { buildModuleGraph, findModuleCycles, findBoundaryViolations } from "../../tools/module_graph.mjs";

test("module graph parses imports, reexports, dynamic imports and worker URLs without comment/string false positives", () => {
  const source = `
    // import './missing-comment.js';
    const text = "export * from './missing-string.js'";
    const pattern = /import\('missing-regex'\)/;
    import './a.js';
    import /* format */ { a } from './a.js';
    export { a as b } from './a.js';
    export * from './a.js';
    export * as ns from './a.js';
    const lazy = import( /* format */ './a.js');
    const templated = import(\`./a.js\`);
    const nested = \`text \${import('./a.js')}\`;
    new Worker(new URL('./a.js', import.meta.url), { type: 'module' });
    new globalThis.Worker('/src/a.js');
    new SharedWorker('/src/a.js');
    new window.Worker(new URL('./a.js', import.meta.url));
    const WorkerAlias = Worker;
    new WorkerAlias(new URL('./a.js', import.meta.url));
    new URL('./picture.svg', import.meta.url);
  `;
  const { graph, diagnostics } = buildModuleGraph(new Map([["main.js", source], ["a.js", "export const a = 1;"]]));
  assert.deepEqual(diagnostics, []);
  assert.equal(graph.get("main.js").length, 13);
  assert.ok(graph.get("main.js").every((edge) => edge.target === "a.js" && edge.line > 0));
  assert.deepEqual(findModuleCycles(graph), []);
});

test("ordinary resource URLs are not executable dependency edges", () => {
  const { graph, diagnostics } = buildModuleGraph(new Map([["main.js", "new URL('./missing.js', import.meta.url);"]]));
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(graph.get("main.js"), []);
});

test("app utilities cannot depend on controllers outside the composition root", () => {
  const sources = new Map([
    ["app/helper.js", "import './input_controller.js';"],
    ["app/workbench_controllers.js", "import './input_controller.js';"],
    ["app/input_controller.js", ""]
  ]);
  const { graph, diagnostics } = buildModuleGraph(sources);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(findBoundaryViolations(graph), [
    "app/helper.js:1 --ImportDeclaration--> app/input_controller.js"
  ]);
});

test("app dependency ranks prevent leaf utilities from reaching state or workspace orchestrators", () => {
  const sources = new Map([
    ["app/leaf.js", "import './appState.js';"],
    ["app/appState.js", "import './workspaceArtifactCache.js';"],
    ["app/workspaceArtifactCache.js", ""]
  ]);
  const { graph, diagnostics } = buildModuleGraph(sources);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(findBoundaryViolations(graph), [
    "app/leaf.js:1 --ImportDeclaration--> app/appState.js"
  ]);
});

test("nested layers and reexport barrels cannot hide illegal dependencies", () => {
  const sources = new Map([
    ["layout/deep/adapter.js", "export * from '../../domains/private.js';"],
    ["domains/private.js", "import '../app/main.js';"],
    ["app/main.js", ""]
  ]);
  const { graph, diagnostics } = buildModuleGraph(sources);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(findBoundaryViolations(graph), [
    "domains/private.js:1 --ImportDeclaration--> app/main.js",
    "layout/deep/adapter.js:1 --ExportAllDeclaration--> domains/private.js"
  ]);
});

test("UI can only import the named legacy app helpers", () => {
  const sources = new Map([
    ["ui/allowed.js", "import '../app/quickInput.js'; import '../app/processLog.js';"],
    ["ui/forbidden.js", "import '../app/input_controller.js';"],
    ["app/quickInput.js", ""],
    ["app/processLog.js", ""],
    ["app/input_controller.js", ""]
  ]);
  const { graph, diagnostics } = buildModuleGraph(sources);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(findBoundaryViolations(graph), [
    "ui/forbidden.js:1 --ImportDeclaration--> app/input_controller.js"
  ]);
});

test("legacy UI helper allowlist cannot hide a transitive app dependency", () => {
  const sources = new Map([
    ["ui/view.js", "import '../app/quickInput.js';"],
    ["app/quickInput.js", "export * from './input_controller.js';"],
    ["app/input_controller.js", ""]
  ]);
  const { graph, diagnostics } = buildModuleGraph(sources);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(findBoundaryViolations(graph), [
    "app/quickInput.js:1 --ExportAllDeclaration--> app/input_controller.js"
  ]);
});

test("cycles include a concrete witness across barrels, dynamic imports and self references", () => {
  const { graph } = buildModuleGraph(new Map([
    ["a.js", "export * from './b.js';"], ["b.js", "import('./c.js');"],
    ["c.js", "import './a.js';"], ["self.js", "import './self.js';"], ["isolated.js", ""]
  ]));
  assert.deepEqual(findModuleCycles(graph), [["a.js", "b.js", "c.js", "a.js"], ["self.js", "self.js"]]);
});

test("invalid syntax, unresolved or opaque module requests fail closed", () => {
  for (const source of ["import './missing.js';", "import(target);", "import(`./${target}.js`);", "import 'package';", "export {", "new Worker(target);", "new Worker('./a.js');", "new Worker(new URL('./a.js', location.href));"]) {
    const { diagnostics } = buildModuleGraph(new Map([["a.js", source]]));
    assert.equal(diagnostics.length, 1, source);
    assert.match(diagnostics[0], /^a.js:/);
  }
});
