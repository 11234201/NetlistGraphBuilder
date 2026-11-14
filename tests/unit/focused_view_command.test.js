import assert from "node:assert/strict";
import test from "node:test";
import { runFocusedViewCommand } from "../../src/application/focused_view_command.js";
import { createViewSessionStore } from "../../src/application/view_session_store.js";
import { createCommandBus } from "../../src/application/command_bus.js";
import { createViewCommandHandlers } from "../../src/application/view_commands.js";
import { createObjectRef, objectRefKey } from "../../src/contracts/object_ref.js";

test("Focused execution follows real command effects for add, repeated add, reveal and capacity rejection", () => {
  const sessions = createViewSessionStore([{ sessionId: "single", documentId: "doc", domainId: "netlist", unitId: "top" }]);
  const bus = createCommandBus(createViewCommandHandlers({ sessions, maxFocusedRoots: 1 }));
  const ref = createObjectRef({ documentId: "doc", unitId: "top", kind: "cell", localId: "u" });
  const graph = { nodes: [{ id: "cell:u" }] }, events = [];
  const execute = (command) => runFocusedViewCommand({
    command: { sessionId: "single", ...command }, dispatch: bus.dispatch,
    readGraph: () => graph, resetViewport: () => events.push("viewport"),
    rebuild: ({ onRendered }) => { events.push("rebuild"); onRendered(graph); },
    onRendered: (value) => { assert.equal(value, graph); events.push("ready"); },
    onUnchanged: (value) => { assert.equal(value, graph); events.push("reuse"); },
    onRejected: (reason) => events.push(reason)
  });
  execute({ type: "focus.add", objectRef: ref });
  assert.deepEqual(events, ["viewport", "rebuild", "ready"]);
  events.length = 0;
  execute({ type: "focus.add", objectRef: ref });
  assert.deepEqual(events, ["reuse"]);
  events.length = 0;
  execute({ type: "selection.reveal", objectRef: ref, visibleObjectKeys: [objectRefKey(ref)] });
  assert.deepEqual(events, ["reuse"]);
  events.length = 0;
  const previous = sessions.require("single");
  execute({ type: "focus.add", objectRef: { ...ref, localId: "other" } });
  assert.deepEqual(events, ["focused-root-capacity"]);
  assert.equal(sessions.require("single"), previous);
});
