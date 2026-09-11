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

test("module hierarchy gives repeated nested instance paths distinct identities", () => {
  const roots = buildModuleHierarchy({ modules: [
    module("leaf"),
    module("mid", [instance("u_leaf", "leaf")]),
    module("top", [instance("u_mid0", "mid"), instance("u_mid1", "mid")])
  ] });
  const leafIds = roots[0].children.map((child) => child.children[0].id);
  assert.equal(new Set(leafIds).size, 2);
  assert.match(leafIds[0], /u_mid0:mid\/u_leaf:leaf$/);
  assert.match(leafIds[1], /u_mid1:mid\/u_leaf:leaf$/);
});

test("module hierarchy bounds recursive definitions and escapes rendered labels", () => {
  const roots = buildModuleHierarchy({ modules: [module("loop", [instance("<self>", "loop")], "<loop>")] });
  assert.equal(roots[0].children[0].cycle, true);
  const html = renderModuleHierarchyPanel(roots, "loop");
  assert.match(html, /aria-current="page"/);
  assert.match(html, /&lt;self&gt; : &lt;loop&gt;/);
  assert.doesNotMatch(html, /<self>/);
});

test("module hierarchy bounds repeated expansion and reports truncation", () => {
  const roots = buildModuleHierarchy({ modules: [
    module("leaf"),
    module("top", Array.from({ length: 10 }, (_, index) => instance(`u${index}`, "leaf")))
  ] }, { maximumNodes: 3 });
  assert.equal(roots[0].children.length, 2);
  assert.equal(roots.truncated, true);
  assert.equal(roots[0].truncated, true);
  assert.match(renderModuleHierarchyPanel(roots, "top"), /More instances omitted/);
});
