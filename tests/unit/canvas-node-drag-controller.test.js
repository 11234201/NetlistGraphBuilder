import assert from "node:assert/strict";
import test from "node:test";
import { startCanvasNodeDrag } from "../../src/ui/canvas_node_drag_controller.js";

function pointerTarget() {
  const listeners = {};
  return {
    listeners,
    classList: { add() {}, remove() {} },
    addEventListener(type, handler) { listeners[type] = handler; },
    removeEventListener(type) { delete listeners[type]; },
    setPointerCapture() {},
    hasPointerCapture: () => true,
    releasePointerCapture() {}
  };
}

function dragMount(nodeId) {
  const nodeElement = {
    dataset: { nodeId },
    classList: { add() {}, remove() {} },
    getAttribute: () => null,
    setAttribute() {},
    removeAttribute() {}
  };
  const matrix = { inverse: () => matrix };
  const svg = {
    createSVGPoint() {
      return {
        x: 0,
        y: 0,
        matrixTransform() { return { x: this.x, y: this.y }; }
      };
    }
  };
  return {
    querySelector(selector) {
      if (selector === "svg") return svg;
      if (selector === "#schematicContent") return { getScreenCTM: () => matrix };
      return null;
    },
    querySelectorAll(selector) {
      return selector === "[data-node-id]" ? [nodeElement] : [];
    }
  };
}

test("shared node drag coalesces preview updates and commits once", () => {
  const target = pointerTarget();
  const graph = { nodes: [{ id: "n1", x: 16, y: 16, width: 20, height: 20 }], edges: [] };
  let position;
  const commits = [];
  assert.equal(startCanvasNodeDrag({
    event: { clientX: 10, clientY: 10, pointerId: 3, preventDefault() {} },
    target,
    mount: dragMount("n1"),
    graph,
    node: graph.nodes[0],
    getPreviousPosition: () => position,
    updatePosition: (next) => { position = next; },
    onCommit: (result) => commits.push(result.position)
  }), true);
  target.listeners.pointermove({ clientX: 31, clientY: 19 });
  target.listeners.pointerup({ type: "pointerup" });
  assert.deepEqual(position, { x: 40, y: 24 });
  assert.deepEqual(commits, [{ x: 40, y: 24 }]);
});

test("node drag without movement clears preview without committing", () => {
  const target = pointerTarget();
  const graph = { nodes: [{ id: "n1", x: 16, y: 16, width: 20, height: 20 }], edges: [] };
  let commits = 0;
  assert.equal(startCanvasNodeDrag({
    event: { clientX: 10, clientY: 10, pointerId: 4 },
    target,
    mount: dragMount("n1"),
    graph,
    node: graph.nodes[0],
    updatePosition() {},
    onCommit: () => { commits += 1; }
  }), true);
  target.listeners.pointerup({ type: "pointerup" });
  assert.equal(commits, 0);
});

test("node drag rejects an unavailable SVG coordinate surface", () => {
  assert.equal(startCanvasNodeDrag({}), false);
});
