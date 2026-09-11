import assert from "node:assert/strict";
import test from "node:test";
import { createCommandBus } from "../../src/application/command_bus.js";
import { createDocumentStore } from "../../src/application/document_store.js";
import { createViewCommandHandlers } from "../../src/application/view_commands.js";
import { createViewSessionStore } from "../../src/application/view_session_store.js";
import { createObjectRef, objectRefKey } from "../../src/contracts/object_ref.js";
import { createDocumentEnvelope } from "../../src/contracts/document.js";

const ref = (localId, unitId = "top", documentId = "doc:1") => createObjectRef({ documentId, unitId, kind: "cell", localId });

function setup(maxFocusedRoots = 2) {
  const sessions = createViewSessionStore();
  sessions.create({ sessionId: "left", documentId: "doc:1", domainId: "netlist", unitId: "top" });
  sessions.create({ sessionId: "right", documentId: "doc:1", domainId: "netlist", unitId: "top" });
  return { sessions, bus: createCommandBus(createViewCommandHandlers({ sessions, maxFocusedRoots })) };
}

test("document and session stores close related state explicitly", () => {
  const documents = createDocumentStore();
  const document = createDocumentEnvelope({ documentId: "doc:1", domainId: "netlist", model: {} });
  documents.open(document);
  const { sessions } = setup();
  assert.equal(documents.require("doc:1"), document);
  assert.equal(sessions.closeByDocument("doc:1"), 2);
  assert.deepEqual(sessions.list(), []);
  assert.equal(documents.close("doc:1"), true);
});

test("viewport updates advance UI revision without invalidating computation revision", () => {
  const { sessions } = setup();
  const before = sessions.require("left");
  const after = sessions.updateViewport("left", { x: 8, y: 4, scale: 1.5 });
  assert.equal(after.sessionRevision, before.sessionRevision + 1);
  assert.equal(after.computationRevision, before.computationRevision);
});

test("focused commands isolate sessions and reject capacity without replacing roots", () => {
  const { sessions, bus } = setup();
  bus.dispatch({ type: "focus.add", sessionId: "left", objectRef: ref("u1") });
  bus.dispatch({ type: "focus.add", sessionId: "left", objectRef: ref("u2") });
  const rejected = bus.dispatch({ type: "focus.add", sessionId: "left", objectRef: ref("u3") });
  assert.equal(rejected.rejected, "focused-root-capacity");
  assert.deepEqual(sessions.require("left").focusedRootRefs.map((item) => item.localId), ["u1", "u2"]);
  assert.deepEqual(sessions.require("right").focusedRootRefs, []);
});

test("selection reveal only centers visible objects and adds hidden objects to Focused", () => {
  const { sessions, bus } = setup();
  const u1 = ref("u1");
  const visible = bus.dispatch({ type: "selection.reveal", sessionId: "left", objectRef: u1, visibleObjectKeys: [objectRefKey(u1)] });
  assert.deepEqual(visible.effects, { query: false, layout: false, render: false, viewport: true, persist: false });
  assert.equal(sessions.require("left").viewMode, "whole");

  const hidden = bus.dispatch({ type: "selection.reveal", sessionId: "left", objectRef: ref("u2"), visibleObjectKeys: [] });
  assert.equal(hidden.effects.layout, true);
  assert.deepEqual(sessions.require("left").focusedRootRefs.map((item) => item.localId), ["u2"]);
  bus.dispatch({ type: "selection.reveal", sessionId: "left", objectRef: ref("u3"), visibleObjectKeys: [] });
  assert.deepEqual(sessions.require("left").focusedRootRefs.map((item) => item.localId), ["u2", "u3"]);
});

test("cross-unit reveal changes scope and never reuses roots from the old unit", () => {
  const { sessions, bus } = setup();
  bus.dispatch({ type: "focus.add", sessionId: "left", objectRef: ref("u1") });
  bus.dispatch({ type: "selection.reveal", sessionId: "left", objectRef: ref("x1", "child"), visibleObjectKeys: [] });
  const session = sessions.require("left");
  assert.equal(session.unitId, "child");
  assert.deepEqual(session.focusedRootRefs.map((item) => item.localId), ["x1"]);
  assert.throws(() => bus.dispatch({ type: "focus.add", sessionId: "left", objectRef: ref("foreign", "child", "doc:2") }), /another document/);
});

test("selection, viewport, layout policy and overrides have explicit command ownership", () => {
  const { sessions, bus } = setup();
  const selected = bus.dispatch({ type: "selection.set", sessionId: "left", objectRef: ref("u1") });
  assert.equal(selected.session.selectedObjectRef.localId, "u1");
  assert.equal(selected.effects.render, true);
  const beforeViewport = selected.session.computationRevision;
  const viewport = bus.dispatch({ type: "viewport.set", sessionId: "left", viewport: { x: 4, y: 8, scale: 1.5 } });
  assert.deepEqual(viewport.session.viewport, { x: 4, y: 8, scale: 1.5 });
  assert.equal(viewport.session.computationRevision, beforeViewport);
  const policy = bus.dispatch({ type: "layout.policy.set", sessionId: "left", layoutPolicy: { name: "test" } });
  assert.equal(policy.effects.layout, true);
  assert.equal(policy.session.computationRevision, beforeViewport + 1);
  const overrides = bus.dispatch({ type: "overrides.set", sessionId: "left", overrides: { nodePositions: [] } });
  assert.deepEqual(overrides.session.overrides, { nodePositions: [] });
  assert.equal(bus.dispatch({ type: "selection.clear", sessionId: "left" }).session.selectedObjectRef, null);
  assert.throws(() => bus.dispatch({ type: "viewport.set", sessionId: "left", viewport: { x: 0, y: 0, scale: 0 } }), /finite positive viewport/);
});

test("focused root replacement and clear are owned by commands", () => {
  const { sessions, bus } = setup();
  const replaced = bus.dispatch({
    type: "focus.replace", sessionId: "left",
    objectRefs: [ref("u2"), ref("u1"), ref("u2")], activeObjectRef: ref("u1")
  });
  assert.deepEqual(replaced.session.focusedRootRefs.map((item) => item.localId), ["u2", "u1"]);
  assert.equal(replaced.session.activeFocusedRootRef.localId, "u1");
  const cleared = bus.dispatch({ type: "focus.clear", sessionId: "left" });
  assert.equal(cleared.session.viewMode, "whole");
  assert.deepEqual(sessions.require("left").focusedRootRefs, []);
});
