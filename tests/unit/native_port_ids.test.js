import assert from "node:assert/strict";
import test from "node:test";
import { createNativePortIdEncoder } from "../../src/layout/native_port_ids.js";

function endpoints(nodes) {
  return nodes.flatMap((node) => node.ports.length
    ? node.ports.map((port) => [node.id, port])
    : ["source", "target"].map((role) => [node.id, null, role]));
}

test("native endpoint IDs preserve unambiguous legacy IDs including delimiter names", () => {
  const nodes = [{ id: "cell:a::b", ports: [{ id: "output:Z" }, { id: "input:A%3A0" }] },
    { id: "unused", ports: [{ id: "x::y" }] }, { id: "implicit", ports: [] }];
  const encode = createNativePortIdEncoder(nodes);
  assert.deepEqual(endpoints(nodes).map((args) => encode(...args)), [
    "cell:a::b::output:Z", "cell:a::b::input:A%3A0", "unused::x::y",
    "implicit::virtual:source", "implicit::virtual:target"
  ]);
});

test("native endpoint IDs keep safe suffixes distinct across trailing node delimiters", () => {
  const nodes = [{ id: "a:", ports: [{ id: "b" }] }, { id: "a", ports: [{ id: "b:" }] },
    { id: "a::virtual", ports: [] }];
  const encode = createNativePortIdEncoder(nodes);
  assert.deepEqual(endpoints(nodes).map((args) => encode(...args)), [
    "a:::b", "a::b:", "a::virtual::virtual:source", "a::virtual::virtual:target"
  ]);
});

test("native endpoint IDs separate ambiguous boundaries and virtual terminals", () => {
  const cases = [
    [{ id: "a::b", ports: [{ id: "c" }] }, { id: "a", ports: [{ id: "b::c" }] }],
    [{ id: "a:", ports: [{ id: "b" }] }, { id: "a", ports: [{ id: ":b" }] }],
    [{ id: "a::b", ports: [] }, { id: "a", ports: [{ id: "b::virtual:source" }] }]
  ];
  for (const nodes of cases) {
    // An unrelated tuple-looking string must not collide with an escaped ID.
    nodes.push({ id: '["a","port","b::c"]', ports: [{ id: 'quote"\\\ud800' }, { id: "控制" }] });
    const encode = createNativePortIdEncoder(nodes);
    const values = endpoints(nodes).map((args) => encode(...args));
    assert.equal(new Set(values).size, values.length);
    for (const [index, [nodeId, port, role]] of endpoints(nodes).entries()) {
      assert.deepEqual(JSON.parse(values[index]), [nodeId, port ? "port" : "virtual", port ? port.id : role]);
    }
    const permuted = createNativePortIdEncoder(nodes.toReversed().map((node) => ({ ...node, ports: node.ports.toReversed() })));
    assert.deepEqual(endpoints(nodes).map((args) => permuted(...args)), values);
  }
});
