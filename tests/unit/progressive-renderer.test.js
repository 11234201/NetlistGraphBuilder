import assert from "node:assert/strict";
import test from "node:test";
import { renderSchematicIntoMount } from "../../src/render/progressiveSvgRenderer.js";
import {
  createProgressiveSchematicRenderPlan,
  createSchematicRenderPlan
} from "../../src/render/svgRenderer.js";

const graph = {
  moduleDisplayName: "progressive",
  width: 640,
  height: 420,
  nodes: [
    { id: "input:a", kind: "input", label: "a", x: 10, y: 40, width: 92, height: 28 },
    { id: "output:y", kind: "output", label: "y", x: 300, y: 40, width: 92, height: 36 }
  ],
  edges: [{
    id: "edge:a-y",
    source: "input:a",
    target: "output:y",
    net: "a",
    label: "a",
    points: [{ x: 102, y: 54 }, { x: 300, y: 54 }],
    labelPoint: { x: 220, y: 46 },
    labelAnchor: "start"
  }]
};

test("progressive render plan produces the same item markup lazily", () => {
  const eager = createSchematicRenderPlan(graph);
  const progressive = createProgressiveSchematicRenderPlan(graph);

  assert.equal(progressive.edgeCount, eager.edges.length);
  assert.equal(progressive.nodeCount, eager.nodes.length);
  assert.deepEqual(progressive.renderEdges(0, 1), eager.edges);
  assert.deepEqual(progressive.renderNodes(0, 2), eager.nodes);
  assert.deepEqual(progressive.renderNodes(2, 3), []);
});

test("large mount rendering submits edge and node markup in bounded batches", async () => {
  const insertions = [];
  const progress = [];
  const groups = {
    ".edges": {
      insertAdjacentHTML(position, html) {
        insertions.push({ group: "edges", position, html });
      }
    },
    ".nodes": {
      insertAdjacentHTML(position, html) {
        insertions.push({ group: "nodes", position, html });
      }
    }
  };
  const mount = {
    innerHTML: "",
    querySelector(selector) {
      return groups[selector];
    }
  };

  const result = await renderSchematicIntoMount(mount, graph, {
    threshold: 1,
    batchSize: 1,
    onProgress: (value) => progress.push(value)
  });

  assert.deepEqual(result, { progressive: true, cancelled: false });
  assert.deepEqual(insertions.map((item) => item.group), ["edges", "nodes", "nodes"]);
  assert.ok(insertions.every((item) => item.position === "beforeend"));
  assert.match(insertions[0].html, /edge:a-y/);
  assert.deepEqual(progress.map((item) => item.rendered), [0, 1, 2, 3]);
  assert.ok(progress.every((item) => item.total === 3));
});

test("render options are preserved in synchronous and progressive paths", async () => {
  const crossingGraph = {
    ...graph,
    nodes: [],
    edges: [
      {
        id: "horizontal",
        net: "n1",
        points: [{ x: 10, y: 50 }, { x: 100, y: 50 }],
        labelPoint: { x: 20, y: 40 },
        label: "n1"
      },
      {
        id: "vertical",
        net: "n2",
        points: [{ x: 50, y: 10 }, { x: 50, y: 90 }],
        labelPoint: { x: 60, y: 20 },
        label: "n2"
      }
    ]
  };

  const defaultMount = { innerHTML: "" };
  await renderSchematicIntoMount(defaultMount, crossingGraph);
  assert.match(defaultMount.innerHTML, /wire-bridge/);

  const syncMount = { innerHTML: "" };
  await renderSchematicIntoMount(syncMount, crossingGraph, { wireBridges: false });
  assert.doesNotMatch(syncMount.innerHTML, /wire-bridge/);

  const progressiveGraph = {
    ...crossingGraph,
    nodes: [{ id: "input:a", kind: "input", label: "a", x: 0, y: 0, width: 40, height: 20 }]
  };
  const progressiveInsertions = [];
  const groups = {
    ".edges": {
      insertAdjacentHTML(position, html) {
        progressiveInsertions.push({ position, html });
      }
    },
    ".nodes": {
      insertAdjacentHTML() {}
    }
  };
  const progressiveMount = {
    innerHTML: "",
    querySelector(selector) {
      return groups[selector];
    }
  };

  await renderSchematicIntoMount(progressiveMount, progressiveGraph, {
    threshold: 1,
    batchSize: 2,
    wireBridges: false
  });
  assert.doesNotMatch(progressiveInsertions.map((item) => item.html).join(""), /wire-bridge/);
});
