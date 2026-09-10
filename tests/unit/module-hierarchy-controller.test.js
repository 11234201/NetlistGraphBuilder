import assert from "node:assert/strict";
import test from "node:test";
import { createModuleHierarchyController } from "../../src/ui/module_hierarchy_controller.js";

test("module hierarchy controller renders and navigates through restricted ports", () => {
  let clickHandler;
  const container = {
    innerHTML: "",
    addEventListener(type, handler) { if (type === "click") clickHandler = handler; }
  };
  const design = {
    modules: [
      { name: "child", displayName: "child", instances: [] },
      { name: "top", displayName: "top", instances: [{ instance: "u0", type: "child" }] }
    ]
  };
  const navigated = [];
  const controller = createModuleHierarchyController({
    container,
    getDesign: () => design,
    getCurrentModuleName: () => "top",
    navigate: (name) => navigated.push(name)
  });
  controller.render();
  assert.match(container.innerHTML, /top/);
  assert.match(container.innerHTML, /child/);
  assert.equal(clickHandler({ target: { closest: () => ({ dataset: { moduleHierarchyName: "top" } }) } }), false);
  assert.equal(clickHandler({ target: { closest: () => ({ dataset: { moduleHierarchyName: "child" } }) } }), true);
  assert.deepEqual(navigated, ["child"]);
});

test("module hierarchy controller clears when no design is open", () => {
  const container = { innerHTML: "stale", addEventListener() {} };
  const controller = createModuleHierarchyController({
    container,
    getDesign: () => null,
    getCurrentModuleName: () => null,
    navigate() {}
  });
  controller.render();
  assert.equal(container.innerHTML, "");
});
