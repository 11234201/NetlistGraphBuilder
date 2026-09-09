import assert from "node:assert/strict";
import test from "node:test";
import { buildModuleHierarchy } from "../../src/domains/netlist/module_hierarchy.js";
import { renderModuleHierarchyPanel } from "../../src/ui/module_hierarchy_panel.js";

const module = (name, cells = [], displayName = name) => ({ name, displayName, cells });
const instance = (name, type) => ({ instance: name, instanceDisplayName: name, type });

test("module hierarchy preserves repeated instances and identifies top modules", () => {
  const roots = buildModuleHierarchy({ modules: [
    module("leaf"),
    module("mid", [instance("u0", "leaf"), instance("u1", "leaf")]),
    module("top", [instance("core", "mid")])
  ] });
  assert.equal(roots.length, 1);
  assert.equal(roots[0].moduleName, "top");
  assert.deepEqual(roots[0].children[0].children.map((node) => node.instanceName), ["u0", "u1"]);
});

test("module hierarchy bounds recursive definitions and escapes rendered labels", () => {
  const roots = buildModuleHierarchy({ modules: [module("loop", [instance("<self>", "loop")], "<loop>")] });
  assert.equal(roots[0].children[0].cycle, true);
  const html = renderModuleHierarchyPanel(roots, "loop");
  assert.match(html, /aria-current="page"/);
  assert.match(html, /&lt;self&gt; : &lt;loop&gt;/);
  assert.doesNotMatch(html, /<self>/);
});
