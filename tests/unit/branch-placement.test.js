import assert from "node:assert/strict";
import test from "node:test";
import {
  applyControlledSinkBranchPlacement,
  alignFocusedBranchBlock,
  alignFocusedRootSpine,
  centerFocusedCoreLayers,
  chooseControlledBranchPlacement,
  findControlledSinkBankCenter
} from "../../src/layout/layered/branchPlacement.js";

function node(id, level, y, height = 20) {
  return { id, kind: "cell", label: id, level, x: level * 100, y, width: 60, height };
}

function graph() {
  const nodes = [
    node("control", 0, 0),
    node("p0", 1, 0), node("p1", 1, 100), node("p2", 1, 220),
    node("s0", 2, 0), node("s1", 2, 28), node("s2", 2, 56)
  ];
  const edges = [
    { id: "c0", source: "control", target: "s0" },
    { id: "c1", source: "control", target: "s1" },
    { id: "c2", source: "control", target: "s2" },
    { id: "d0", source: "p0", target: "s0" },
    { id: "d1", source: "p1", target: "s1" },
    { id: "d2", source: "p2", target: "s2" }
  ];
  return { nodes, edges };
}

test("controlled sink placement propagates data-parent branch whitespace", () => {
  const { nodes, edges } = graph();
  const result = applyControlledSinkBranchPlacement(nodes, edges, [0, 1, 2], {
    gap: 8,
    sharedSourceFanout: 3,
    primarySourceFanout: 1
  });

  assert.equal(result.sinkCount, 3);
  assert.deepEqual(nodes.slice(4).map((entry) => entry.y), [0, 100, 220]);
});

test("branch candidate selection requires alignment and structured whitespace", () => {
  const { nodes: base, edges } = graph();
  const candidate = base.map((entry) => ({ ...entry }));
  applyControlledSinkBranchPlacement(candidate, edges, [0, 1, 2], {
    gap: 8,
    sharedSourceFanout: 3,
    primarySourceFanout: 1
  });
  const selection = chooseControlledBranchPlacement(base, candidate, edges, {
    minimumAlignmentImprovement: 0.1,
    sharedSourceFanout: 3,
    primarySourceFanout: 1
  });

  assert.equal(selection.selected, true);
  assert.equal(selection.reason, "branch-structure-improved");
});

test("controlled sink placement is invariant to graph array order", () => {
  const first = graph();
  const second = graph();
  second.nodes.reverse();
  second.edges.reverse();
  const options = { gap: 8, sharedSourceFanout: 3, primarySourceFanout: 1 };
  applyControlledSinkBranchPlacement(first.nodes, first.edges, [0, 1, 2], options);
  applyControlledSinkBranchPlacement(second.nodes, second.edges, [0, 1, 2], options);

  assert.deepEqual(
    new Map(first.nodes.map((entry) => [entry.id, entry.y])),
    new Map(second.nodes.map((entry) => [entry.id, entry.y]))
  );
});

test("controlled sink placement reserves regular whitespace between branch bands", () => {
  const { nodes, edges } = graph();
  nodes.push(node("p3", 1, 340), node("s3", 2, 84));
  edges.push(
    { id: "c3", source: "control", target: "s3" },
    { id: "d3", source: "p3", target: "s3" }
  );
  applyControlledSinkBranchPlacement(nodes, edges, [0, 1, 2], {
    gap: 8,
    sharedSourceFanout: 4,
    primarySourceFanout: 1,
    branchBandSize: 2,
    branchBandGap: 60,
    branchCenterGap: 120
  });
  const sinks = nodes.filter((entry) => entry.id.startsWith("s")).sort((left, right) => left.y - right.y);
  assert.ok(sinks[2].y - (sinks[1].y + sinks[1].height) >= 120);
});

test("focused root spine aligns to its high-fanout branch source", () => {
  const root = { ...node("root", 0, 0), isFocusedRoot: true };
  const peer = node("peer", 0, 200);
  const middle = node("middle", 1, 0);
  const hub = { ...node("hub", 2, 100), kind: "hub" };
  const targets = Array.from({ length: 8 }, (_, index) => node(`t${index}`, 3, index * 28));
  const nodes = [root, peer, middle, hub, ...targets];
  const edges = [
    { id: "rm", source: "root", target: "middle" },
    { id: "mh", source: "middle", target: "hub" },
    ...targets.map((target) => ({ id: `h-${target.id}`, source: "hub", target: target.id }))
  ];
  const result = alignFocusedRootSpine(nodes, edges, [0, 1, 2, 3], { gap: 8 });

  assert.equal(result.pathCount, 1);
  assert.equal(root.y + root.height / 2, hub.y + hub.height / 2);
  assert.equal(middle.y + middle.height / 2, hub.y + hub.height / 2);
});

test("focused branch block moves the fanin cone with the root spine", () => {
  const input = node("input", 0, 0);
  const gate = node("gate", 1, 0);
  const root = { ...node("root", 2, 0), isFocusedRoot: true };
  const middle = node("middle", 3, 0);
  const hub = { ...node("hub", 4, 200), kind: "hub" };
  const targets = Array.from({ length: 8 }, (_, index) => node(`t${index}`, 5, index * 28));
  const nodes = [input, gate, root, middle, hub, ...targets];
  const edges = [
    { id: "ig", source: "input", target: "gate" },
    { id: "gr", source: "gate", target: "root" },
    { id: "rm", source: "root", target: "middle" },
    { id: "mh", source: "middle", target: "hub" },
    ...targets.map((target) => ({ id: `h-${target.id}`, source: "hub", target: target.id }))
  ];
  const result = alignFocusedBranchBlock(nodes, edges, [0, 1, 2, 3, 4, 5], { gap: 8 });

  assert.equal(result.blockCount, 1);
  assert.equal(input.y, 200);
  assert.equal(gate.y, 200);
  assert.equal(root.y, 200);
  assert.equal(middle.y, 200);
});

test("controlled sink bank center follows topology-selected large columns", () => {
  const nodes = [node("control", 0, 0)];
  const edges = [];
  for (let index = 0; index < 4; index += 1) {
    nodes.push(node(`p${index}`, 1, index * 100));
    nodes.push(node(`s${index}`, 2, index * 100));
    edges.push(
      { id: `c${index}`, source: "control", target: `s${index}` },
      { id: `d${index}`, source: `p${index}`, target: `s${index}` }
    );
  }
  assert.equal(findControlledSinkBankCenter(nodes, edges, {
    minimumBankSize: 4,
    sharedSourceFanout: 4,
    primarySourceFanout: 1
  }), 160);
});

test("focused core centering translates whole layers without changing their order or offsets", () => {
  const nodes = [node("control", 0, 0), node("a", 1, 0), node("b", 1, 40)];
  const edges = [];
  for (let index = 0; index < 16; index += 1) {
    nodes.push(node(`p${index}`, 1, index * 100));
    nodes.push(node(`s${index}`, 2, 400 + index * 100));
    edges.push(
      { id: `c${index}`, source: "control", target: `s${index}` },
      { id: `d${index}`, source: `p${index}`, target: `s${index}` }
    );
  }
  const beforeDelta = nodes.find((entry) => entry.id === "b").y -
    nodes.find((entry) => entry.id === "a").y;
  const result = centerFocusedCoreLayers(nodes, edges, [0, 1, 2], {
    minimumBankSize: 16
  });

  assert.equal(result.layerCount, 1);
  assert.equal(nodes.find((entry) => entry.id === "b").y -
    nodes.find((entry) => entry.id === "a").y, beforeDelta);
  assert.equal(nodes.find((entry) => entry.id === "a").y <
    nodes.find((entry) => entry.id === "b").y, true);
});

test("focused core centering is invariant to node and edge permutations", () => {
  const build = () => {
    const nodes = [node("control", 0, 0), node("a", 1, 0), node("b", 1, 40)];
    const edges = [];
    for (let index = 0; index < 16; index += 1) {
      nodes.push(node(`p${index}`, 1, index * 100), node(`s${index}`, 2, 400 + index * 100));
      edges.push(
        { id: `c${index}`, source: "control", target: `s${index}` },
        { id: `d${index}`, source: `p${index}`, target: `s${index}` }
      );
    }
    return { nodes, edges };
  };
  const first = build();
  const second = build();
  second.nodes.reverse();
  second.edges.reverse();
  centerFocusedCoreLayers(first.nodes, first.edges, [0, 1, 2], { minimumBankSize: 16 });
  centerFocusedCoreLayers(second.nodes, second.edges, [0, 1, 2], { minimumBankSize: 16 });

  assert.deepEqual(
    new Map(first.nodes.map((entry) => [entry.id, entry.y])),
    new Map(second.nodes.map((entry) => [entry.id, entry.y]))
  );
});
