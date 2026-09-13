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

test("open module hierarchy filters a cached tree and closes after navigation", () => {
  let clickHandler;
  let inputHandler;
  let removedInputHandler;
  let queries = 0;
  const panel = {
    open: true,
    addEventListener() {},
    removeEventListener() {}
  };
  const container = {
    innerHTML: "",
    addEventListener(type, handler) { if (type === "click") clickHandler = handler; },
    removeEventListener() {}
  };
  const filterInput = {
    value: "",
    addEventListener(type, handler) { if (type === "input") inputHandler = handler; },
    removeEventListener(type, handler) { if (type === "input") removedInputHandler = handler; }
  };
  const design = {
    modules: [
      { name: "child", displayName: "child", cells: [] },
      { name: "top", displayName: "top", cells: [
        { instance: "u0", instanceDisplayName: "u0", type: "child" },
        { instance: "u1", instanceDisplayName: "u1", type: "child" }
      ] }
    ]
  };
  const navigated = [];
  const controller = createModuleHierarchyController({
    container,
    panel,
    filterInput,
    getHierarchy: () => (queries += 1, buildModuleHierarchy(design)),
    getCurrentModuleName: () => "top",
    navigate: (name) => navigated.push(name)
  });

  controller.render();
  assert.equal(queries, 1);
  filterInput.value = "u1";
  assert.equal(inputHandler(), true);
  assert.equal(queries, 1);
  assert.match(container.innerHTML, /u1 : child/);
  assert.doesNotMatch(container.innerHTML, /u0 : child/);
  assert.equal(clickHandler({ target: { closest: () => ({ dataset: { moduleHierarchyName: "child" } }) } }), true);
  assert.equal(panel.open, false);
  assert.equal(filterInput.value, "");
  assert.deepEqual(navigated, ["child"]);

  controller.dispose();
  assert.equal(removedInputHandler, inputHandler);
});

test("module hierarchy navigation forwards canonical occurrence context", () => {
  let clickHandler;
  const container = {
    innerHTML: "",
    addEventListener(type, handler) { if (type === "click") clickHandler = handler; },
    removeEventListener() {}
  };
  const navigated = [];
  const controller = createModuleHierarchyController({
    container,
    getHierarchy: () => [],
    getCurrentModuleName: () => "top",
    navigate: (...args) => navigated.push(args)
  });
  assert.equal(clickHandler({ target: {
    closest: () => ({ dataset: {
      moduleHierarchyName: "child",
      moduleHierarchyPath: "u_child/u_leaf",
      moduleHierarchyRoot: "top"
    } })
  } }), true);
  assert.deepEqual(navigated, [["child", {
    occurrencePath: ["u_child", "u_leaf"],
    rootModuleName: "top"
  }]]);
  controller.dispose();
});

test("module hierarchy can choose another occurrence of the current module", () => {
  let clickHandler;
  const container = {
    innerHTML: "",
    addEventListener(type, handler) { if (type === "click") clickHandler = handler; },
    removeEventListener() {}
  };
  const navigated = [];
  const controller = createModuleHierarchyController({
    container,
    getHierarchy: () => [],
    getCurrentModuleName: () => "child",
    getCurrentOccurrenceContext: () => ({ rootModuleName: "top", occurrencePath: ["u0"] }),
    navigate: (...args) => navigated.push(args)
  });
  assert.equal(clickHandler({ target: {
    closest: () => ({ dataset: {
      moduleHierarchyName: "child",
      moduleHierarchyPath: "u1",
      moduleHierarchyRoot: "top"
    } })
  } }), true);
  assert.deepEqual(navigated, [["child", {
    occurrencePath: ["u1"],
    rootModuleName: "top"
  }]]);
  controller.dispose();
});
