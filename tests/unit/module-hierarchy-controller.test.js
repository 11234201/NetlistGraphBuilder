import assert from "node:assert/strict";
import test from "node:test";
import { createModuleHierarchyController } from "../../src/ui/module_hierarchy_controller.js";
import { buildModuleHierarchy } from "../../src/domains/netlist/module_hierarchy.js";

test("module hierarchy controller renders and navigates through restricted ports", () => {
  let clickHandler;
  let removedHandler;
  const container = {
    innerHTML: "",
    addEventListener(type, handler) { if (type === "click") clickHandler = handler; },
    removeEventListener(type, handler) { if (type === "click") removedHandler = handler; }
  };
  const design = {
    modules: [
      { name: "child", displayName: "child", cells: [] },
      { name: "top", displayName: "top", cells: [{ instance: "u0", type: "child" }] }
    ]
  };
  const navigated = [];
  const controller = createModuleHierarchyController({
    container,
    getHierarchy: () => buildModuleHierarchy(design),
    getCurrentModuleName: () => "top",
    navigate: (name) => navigated.push(name)
  });
  controller.render();
  assert.match(container.innerHTML, /top/);
  assert.match(container.innerHTML, /child/);
  assert.equal(clickHandler({ target: { closest: () => ({ dataset: { moduleHierarchyName: "top" } }) } }), false);
  assert.equal(clickHandler({ target: { closest: () => ({ dataset: { moduleHierarchyName: "child" } }) } }), true);
  assert.deepEqual(navigated, ["child"]);
  controller.dispose();
  assert.equal(removedHandler, clickHandler);
});

test("module hierarchy controller clears when no design is open", () => {
  const container = { innerHTML: "stale", addEventListener() {} };
  const controller = createModuleHierarchyController({
    container,
    getHierarchy: () => null,
    getCurrentModuleName: () => null,
    navigate() {}
  });
  controller.render();
  assert.equal(container.innerHTML, "");
});

test("closed module hierarchy defers expansion until the panel opens", () => {
  let toggleHandler;
  let queries = 0;
  const panel = {
    open: false,
    addEventListener(type, handler) { if (type === "toggle") toggleHandler = handler; }
  };
  const container = { innerHTML: "", addEventListener() {} };
  const controller = createModuleHierarchyController({
    container,
    panel,
    getHierarchy: () => (queries += 1, []),
    getCurrentModuleName: () => null,
    navigate() {}
  });
  assert.equal(controller.render(), false);
  assert.equal(queries, 0);
  panel.open = true;
  toggleHandler();
  assert.equal(queries, 1);
});
