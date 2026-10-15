import assert from "node:assert/strict";
import test from "node:test";
import { PlaceAlignmentBlocks } from "../reference/retired_native_layered/block_placement.js";

test("recursive trees remain centred without top packing", () => {
  for (let depth = 2; depth <= 5; depth += 1) {
    const { proper, crossing, children } = MakeBinaryTree(depth);
    const placement = PlaceAlignmentBlocks(proper, crossing, { nodeGap: 20 });
    const byKey = new Map(placement.nodes.map((node) => [node.key, node]));
    for (const [parent, childKeys] of children) {
      const parentNode = byKey.get(parent);
      const centers = childKeys.map((key) => byKey.get(key).y + byKey.get(key).height / 2);
      const childCenter = (Math.min(...centers) + Math.max(...centers)) / 2;
      const parentCenter = parentNode.y + parentNode.height / 2;
      assert.ok(Math.abs(parentCenter - childCenter) <= 40, `${parent} is not centred at depth ${depth}`);
    }
  }
});

test("four candidates and balanced coordinates are deterministic", () => {
  const { proper, crossing } = MakeBinaryTree(3);
  const first = PlaceAlignmentBlocks(proper, crossing);
  const second = PlaceAlignmentBlocks({ ...proper, segments: proper.segments.toReversed() }, crossing);
  assert.equal(first.variants.length, 4);
  assert.deepEqual(second.nodes, first.nodes);
});

function MakeBinaryTree(depth) {
  const nodes = [];
  const layers = [];
  const segments = [];
  const children = new Map();
  for (let rank = 0; rank <= depth; rank += 1) {
    const layerNodes = [];
    for (let index = 0; index < 2 ** rank; index += 1) {
      const key = `${rank}:${index}`;
      const node = { key, rank, width: 100, height: 40, dummy: false };
      nodes.push(node);
      layerNodes.push(node);
      if (rank > 0) {
        const parent = `${rank - 1}:${Math.floor(index / 2)}`;
        const list = children.get(parent) || [];
        list.push(key);
        children.set(parent, list);
        segments.push({ key: `${parent}-${key}`, sourceKey: parent, targetKey: key });
      }
    }
    layers.push({ rank, nodes: layerNodes });
  }
  return {
    proper: { nodes, layers, segments },
    crossing: { layers: layers.map((layer) => ({ rank: layer.rank, nodeKeys: layer.nodes.map((node) => node.key) })) },
    children
  };
}
