import assert from "node:assert/strict";
import test from "node:test";
import { cancelSchematicRender, renderSvgSceneIntoMount } from "../../src/render/progressiveSvgRenderer.js";
import {
  createProgressiveSchematicRenderPlan,
  createSchematicRenderPlan,
  createNetlistScene
} from "../../src/domains/netlist/netlist_scene.js";

function renderSchematicIntoMount(mount, graph, options = {}) {
  return renderSvgSceneIntoMount(mount, createNetlistScene(graph, options), options);
}

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

test("small renders and explicit cancellation supersede pending batches", async () => {
  for (const replace of [
    (mount) => renderSchematicIntoMount(mount, graph),
    (mount) => cancelSchematicRender(mount)
  ]) {
    const insertions = [];
    const mount = { innerHTML: "", querySelector: () => ({
      insertAdjacentHTML: (...args) => insertions.push(args)
    }) };
    const pending = renderSchematicIntoMount(mount, graph, { threshold: 1 });
    await replace(mount);
    assert.equal((await pending).cancelled, true);
    assert.deepEqual(insertions, []);
  }
});

test("invalid workspace prevents pending renderer writes", async () => {
  const mount = { innerHTML: "", querySelector: () => ({
    insertAdjacentHTML() { assert.fail("stale batch"); }
  }) };
  let current = true;
  const pending = renderSchematicIntoMount(mount, graph, { threshold: 1, isCurrent: () => current });
  current = false;
  assert.equal((await pending).cancelled, true);
});

test("progressive render plan produces the same item markup lazily", () => {
  const eager = createSchematicRenderPlan(graph);
  const progressive = createProgressiveSchematicRenderPlan(graph);

  assert.equal(eager.nodes.length, graph.nodes.length);
  assert.equal(eager.edges.length, graph.edges.length);
  assert.match(eager.openSvg, /schematic-content/);
  assert.equal(progressive.edgeCount, eager.edges.length);
  assert.equal(progressive.nodeCount, eager.nodes.length);
  assert.deepEqual(progressive.renderEdges(0, 1), eager.edges);
  assert.deepEqual(progressive.renderNodes(0, 2), eager.nodes);
  assert.deepEqual(progressive.renderNodes(2, 3), []);
});

test("progressive mount accepts the pipeline scene without rebuilding a graph", async () => {
  const scene = createNetlistScene(graph);
  const mount = { innerHTML: "" };
  const progress = [];

  assert.deepEqual(await renderSvgSceneIntoMount(mount, scene, { onProgress: (value) => progress.push(value) }), { progressive: false });
  assert.match(mount.innerHTML, /input:a/);
  assert.deepEqual(progress, [{ phase: "complete", rendered: 3, total: 3 }]);
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

test("edge-heavy scenes use the combined scene size for progressive rendering", async () => {
  const edgeOnlyGraph = { ...graph, nodes: [] };
  const insertions = [];
  const groups = {
    ".edges": {
      insertAdjacentHTML(position, html) {
        insertions.push({ position, html });
      }
    },
    ".nodes": {
      insertAdjacentHTML() {}
    }
  };
  const mount = {
    innerHTML: "",
    querySelector(selector) {
      return groups[selector];
    }
  };

  const result = await renderSchematicIntoMount(mount, edgeOnlyGraph, {
    threshold: 1,
    batchSize: 1
  });

  assert.deepEqual(result, { progressive: true, cancelled: false });
  assert.equal(insertions.length, 1);
  assert.match(insertions[0].html, /edge:a-y/);
});

test("progressive rendering rejects mounts without the required SVG groups", async () => {
  const mount = { innerHTML: "", querySelector: () => null };
  await assert.rejects(
    renderSchematicIntoMount(mount, graph, { threshold: 1 }),
    /did not create edge and node groups/
  );

  mount.querySelector = (selector) => ({
    insertAdjacentHTML() {}
  });
  assert.deepEqual(
    await renderSchematicIntoMount(mount, graph, { threshold: 1 }),
    { progressive: true, cancelled: false }
  );
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

test("a stale small scene cannot write the mount or supersede an active owner", async () => {
  const mount = { innerHTML: "current" };
  const result = await renderSchematicIntoMount(mount, graph, { isCurrent: () => false });
  assert.deepEqual(result, { progressive: false, cancelled: true });
  assert.equal(mount.innerHTML, "current");
  const withoutLabels = { ...graph, edges: graph.edges.map(({ labelPoint, ...edge }) => edge) };
  await renderSchematicIntoMount(mount, withoutLabels);
  assert.match(mount.innerHTML, /class="schematic-content"/);
  assert.doesNotMatch(mount.innerHTML, /class="wire-label"|id="schematicContent"/);
});

test("a generation invalidated by small-scene progress cannot publish a successful render", async () => {
  let current = true;
  const result = await renderSchematicIntoMount({ innerHTML: "" }, graph,
    { isCurrent: () => current, onProgress() { current = false; } });
  assert.equal(result.cancelled, true);
});

test("buffered scene fragments discard stale work and preserve decoding errors", async () => {
  const commits = [];
  let onDecode;
  const document = {
    createRange: () => ({ selectNodeContents() {}, createContextualFragment(html) { onDecode(); return html; } }),
    createDocumentFragment: () => ({ firstChild: null, append(value) { this.firstChild = value; } })
  };
  const group = { ownerDocument: document, append(fragment) { commits.push(fragment.firstChild); } };
  const mount = { querySelector: () => group, innerHTML: "" };
  const scene = createNetlistScene(graph);
  let current = true;
  onDecode = () => { current = false; };
  const result = await renderSvgSceneIntoMount(mount, scene, { threshold: 1, isCurrent: () => current });
  assert.equal(result.cancelled, true);
  const error = new Error("SVG fragment decoder failed", { cause: new Error("invalid markup") });
  onDecode = () => { throw error; };
  await assert.rejects(renderSvgSceneIntoMount(mount, scene, { threshold: 1 }), (caught) => caught === error);
  assert.deepEqual(commits, []);
});
