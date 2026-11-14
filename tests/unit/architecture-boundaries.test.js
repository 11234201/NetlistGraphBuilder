import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readModuleSources, buildModuleGraph, findModuleCycles, findBoundaryViolations } from "../../tools/module_graph.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("browser entry cannot regain workspace scheduling or grow past its migration budget", () => {
  const source = readFileSync(join(projectRoot, "src/app/main.js"), "utf8");
  assert.ok(source.split(/\r?\n/).length <= 465, "Extract a complete responsibility before adding entry code; do not raise the budget");
  assert.doesNotMatch(source, /^(?:async )?function\s+/m, "Entry must only compose controllers and bind browser events");
  for (const file of sourceFiles(join(projectRoot, "src/app"))) {
    if (!file.endsWith("_controller.js")) continue;
    assert.ok(readFileSync(file, "utf8").split(/\r?\n/).length <= 520, `${file} exceeds the responsibility budget`);
  }
  assert.doesNotMatch(source, /workspaceJobs\.(?:start|runSync)\s*\(/);
  assert.doesNotMatch(source, /\.executionMode\s*===/);
  assert.doesNotMatch(source, /\.dispatch\s*\(/, "Entry binds actions; command construction belongs to adapters");
});

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : extname(path) === ".js" ? [path] : [];
  });
}

test("complete runtime module graph is resolved, acyclic and respects layer ownership", () => {
  const { graph, diagnostics } = buildModuleGraph(readModuleSources(join(projectRoot, "src")));
  assert.deepEqual(diagnostics, [], diagnostics.join("\n"));
  const violations = findBoundaryViolations(graph);
  assert.deepEqual(violations, [], violations.join("\n"));
  const cycles = findModuleCycles(graph);
  assert.deepEqual(cycles, [], cycles.map((cycle) => cycle.join(" -> ")).join("\n"));
});

test("domain scene creation and UI panels cannot regain mounting or inference dependencies", () => {
  const graph = new Map([
    ["domains/netlist/example.js", [{ target: "render/progressiveSvgRenderer.js", kind: "ImportDeclaration", line: 1 }]],
    ["ui/example.js", [{ target: "infer/defaultCellRules.js", kind: "ImportDeclaration", line: 2 }]]
  ]);
  const violations = findBoundaryViolations(graph);
  assert.equal(violations.length, 2);
  assert.match(violations[0], /progressiveSvgRenderer/);
  assert.match(violations[1], /defaultCellRules/);
});

test("legacy controllers cannot write migrated ViewSession projections", () => {
  const migrated = "(?:focusedRootRefs|focusedRootNodeIds|activeFocusedRootNodeId|coneRootNodeId|selectedNodeId|selectedNet|selectedName|selectedKind|selectedSide|viewMode|coneDepth|faninDepth|fanoutDepth|transform|transforms|layoutPolicy|presentationPolicy|nodePositions|nodeSizes|graphOverrides)";
  const assignment = new RegExp(`state\\.(?:compare\\.)?${migrated}(?:\\[[^\\]]+\\])?\\s*=(?!=)`);
  for (const file of sourceFiles(join(projectRoot, "src/app"))) {
    if (!file.endsWith("_controller.js")) continue;
    assert.doesNotMatch(readFileSync(file, "utf8"), assignment, file);
  }
});

test("all nested layout implementations consume domain-neutral presentation fields", () => {
  const sources = readModuleSources(join(projectRoot, "src/layout"));
  for (const [name, source] of sources) assert.doesNotMatch(source, /cellPinDirections|netlist-layout-golden/, name);
});

test("shared layout and renderer do not interpret Netlist inference or parser references", () => {
  for (const relativePath of ["src/layout/nodeGeometry.js", "src/layout/nodeSpacing.js", "src/render/svgRenderer.js"]) {
    const source = readFileSync(join(projectRoot, ...relativePath.split("/")), "utf8");
    assert.doesNotMatch(source, /infer\/defaultCellRules|node\.ref/, `${relativePath} must consume presentation fields`);
  }
  const renderer = readFileSync(join(projectRoot, "src", "render", "svgRenderer.js"), "utf8");
  const workspace = readFileSync(join(projectRoot, "src", "app", "moduleWorkspace.js"), "utf8");
  assert.doesNotMatch(renderer, /domains\/netlist/, "shared renderer must not import Netlist presentation");
  assert.match(workspace, /createNetlistScene/, "Netlist workspace must use its domain scene facade");
  const benchmark = readFileSync(join(projectRoot, "tools", "benchmark-large.mjs"), "utf8");
  assert.match(benchmark, /domains\/netlist\/netlist_scene\.js/, "Netlist benchmark must inject domain presentation");
  assert.doesNotMatch(benchmark, /from\s+["']\.\.\/src\/render\/svgRenderer\.js["']/);
});


test("session persistence and rendering cannot implicitly append operation history", () => {
  const persistence = readFileSync(join(projectRoot, "src/app/session_persistence_controller.js"), "utf8");
  assert.doesNotMatch(persistence, /viewHistory|recordViewHistory|pendingViewCommand/);
  const rendering = readFileSync(join(projectRoot, "src/app/workspace_render_controller.js"), "utf8");
  assert.doesNotMatch(rendering, /recordViewHistory|commitViewHistory/);
  const compare = readFileSync(join(projectRoot, "src/app/compare_workspace_controller.js"), "utf8");
  const renderBody = compare.slice(compare.indexOf("function renderCompareGraphs("), compare.indexOf("function commitCompareWorkspace("));
  assert.doesNotMatch(renderBody, /recordViewHistory|commitViewHistory/);
});
