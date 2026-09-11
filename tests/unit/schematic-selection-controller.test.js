import assert from "node:assert/strict";
import test from "node:test";
import { createSchematicSelectionController } from "../../src/ui/schematic_selection_controller.js";

function selectable(kind, data = {}) {
  const classes = new Set([kind, "is-selected"]);
  return { dataset: data, classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) }, classes };
}

test("schematic selection controller owns node and net DOM state through restricted ports", () => {
  const oldNode = selectable("node");
  const targetNode = selectable("node");
  targetNode.classes.delete("is-selected");
  const firstEdge = selectable("edge", { net: "n1" });
  const secondEdge = selectable("edge", { net: "n2" });
  secondEdge.classes.delete("is-selected");
  const calls = [];
  const container = {
    querySelectorAll(selector) {
      return selector === ".edge" ? [firstEdge, secondEdge] : [oldNode, firstEdge];
    },
    querySelector(selector) {
      return selector.includes("cell\\:u0") ? targetNode : null;
    }
  };
  const controller = createSchematicSelectionController({
    container,
    onNodeSelection: (value) => calls.push(["node", value]),
    onNetSelection: (value) => calls.push(["net", value])
  });

  controller.selectNode("cell:u0");
  assert.equal(oldNode.classes.has("is-selected"), false);
  assert.equal(targetNode.classes.has("is-selected"), true);
  controller.selectNet("n2");
  assert.equal(firstEdge.classes.has("is-selected"), false);
  assert.equal(secondEdge.classes.has("is-selected"), true);
  assert.deepEqual(calls, [["node", "cell:u0"], ["net", "n2"]]);
});

test("schematic selection controller validates its bounded dependencies", () => {
  assert.throws(() => createSchematicSelectionController({}), /requires a container/);
});
