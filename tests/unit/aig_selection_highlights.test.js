import test from "node:test";
import assert from "node:assert/strict";
import { updateAigSelectionHighlights } from "../../src/ui/aig_selection_highlights.js";

test("neighbor updates change direction, clear old highlights and leave base shapes untouched", () => {
  const colors = { input: "blue", output: "green" };
  const element = (role, pathCount = 1) => {
    const attributes = new Map(role ? [["data-neighbor-role", role]] : []);
    const halos = Array.from({ length: pathCount }, () => {
      const style = new Map([["visibility", role ? "visible" : "hidden"], ["stroke", colors[role]]]);
      return { style, setAttribute: (name, value) => style.set(name, value) };
    });
    return { attributes, halos, setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name), querySelectorAll(selector) {
        assert.equal(selector, ".aig-neighbor-halo", "base shapes and selection halos must not be rewritten");
        return halos;
      } };
  };
  const input = element("input"), oldEdge = element("input", 2), output = element(null);
  const objects = new Map([["input", input], ["old-edge", oldEdge], ["output", output]]);
  const visits = [];
  // Deliberately expose indexed lookup only: a selection must not enumerate
  // every rendered object in a potentially large graph.
  const elements = { get(id) { visits.push(id); return objects.get(id); } };
  const before = new Map([["input", "input"], ["old-edge", "input"]]);
  const after = new Map([["input", "output"], ["output", "output"], ["unrendered", "input"]]);
  updateAigSelectionHighlights(elements, before, after, colors);
  assert.deepEqual(new Set(visits), new Set(["input", "old-edge", "output", "unrendered"]));
  assert.equal(input.attributes.get("data-neighbor-role"), "output");
  assert.equal(input.halos[0].style.get("stroke"), "green");
  assert.equal(oldEdge.attributes.has("data-neighbor-role"), false);
  assert.ok(oldEdge.halos.every((halo) => halo.style.get("visibility") === "hidden"));
  assert.equal(output.attributes.get("data-neighbor-role"), "output");
  assert.equal(output.halos[0].style.get("visibility"), "visible");
  updateAigSelectionHighlights(elements, after, new Map(), colors);
  for (const object of objects.values()) {
    assert.equal(object.attributes.has("data-neighbor-role"), false);
    assert.ok(object.halos.every((halo) => halo.style.get("visibility") === "hidden"));
  }
});
