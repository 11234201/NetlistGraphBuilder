import assert from "node:assert/strict";
import test from "node:test";
import { createNodeDragPreview } from "../../src/ui/nodeDragPreview.js";

test("drag preview moves only the selected DOM node and marks connected edges", () => {
  const node = createElement({ nodeId: "cell:a" });
  const connected = createElement({ edgeId: "edge:a" });
  const unrelated = createElement({ edgeId: "edge:b" });
  const mount = {
    querySelectorAll(selector) {
      return selector === "[data-node-id]" ? [node] : [connected, unrelated];
    }
  };
  const preview = createNodeDragPreview(mount, {
    edges: [
      { id: "edge:a", source: "cell:a", target: "cell:b" },
      { id: "edge:b", source: "cell:c", target: "cell:d" }
    ]
  }, "cell:a", { x: 10, y: 20 });

  preview.update({ x: 32.25, y: 15 });

  assert.equal(node.attributes.get("transform"), "translate(22.3 -5)");
  assert.equal(node.classes.has("is-drag-preview-node"), true);
  assert.equal(connected.classes.has("is-drag-preview-edge"), true);
  assert.equal(unrelated.classes.has("is-drag-preview-edge"), false);

  preview.clear();
  assert.equal(node.attributes.has("transform"), false);
  assert.equal(node.classes.size, 0);
  assert.equal(connected.classes.size, 0);
});

function createElement(dataset) {
  const attributes = new Map();
  const classes = new Set();
  return {
    dataset,
    attributes,
    classes,
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); }
    }
  };
}
