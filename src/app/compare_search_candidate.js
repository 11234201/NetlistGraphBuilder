import { createViewSessionStore } from "../application/view_session_store.js";
import { createViewCommandHandlers } from "../application/view_commands.js";
import { mergeViewEffects } from "../application/view_effects.js";
import { objectRefToNodeId } from "../domains/netlist/graph_object_refs.js";
import { findSearchTargetNode } from "./searchLocatePolicy.js";

// Run the same Focused command against temporary sessions. Live roots and
// history change only after the candidate workspace has rendered successfully.
export function createCompareSearchCandidate({ context, bridge, side, target }) {
  const sides = ["left", "right"];
  const sessions = createViewSessionStore(sides.map((value) => bridge.readState(value)));
  const handlers = createViewCommandHandlers({ sessions });
  const commands = [];
  const results = [];
  const add = (value) => {
    const node = findSearchTargetNode(target, context.fullGraphs[value]);
    const objectRef = bridge.objectRef(value, node?.kind || target.kind, target.name);
    const command = { type: "focus.add", objectRef, sessionId: `compare:${value}` };
    const result = handlers[command.type](command);
    commands.push({ side: value, command }); results.push(result);
    return result;
  };
  const primary = add(side);
  if (primary.rejected) return primary;
  const opposite = side === "left" ? "right" : "left";
  const oppositePath = context.graphs[opposite]?.path;
  if (context.syncRoots !== false && target.kind === "cell" &&
      findSearchTargetNode(target, context.fullGraphs[opposite]) &&
      (!oppositePath || oppositePath.searchKeys.has(JSON.stringify([target.kind, target.name])))) {
    const matched = add(opposite);
    if (matched.rejected) return matched;
  }
  const focusedRootNodeIds = {}, activeFocusedRootNodeId = {};
  for (const value of sides) {
    const session = sessions.require(`compare:${value}`), graph = context.fullGraphs[value];
    focusedRootNodeIds[value] = session.focusedRootRefs.map((ref) => objectRefToNodeId(ref, graph)).filter(Boolean);
    activeFocusedRootNodeId[value] = objectRefToNodeId(session.activeFocusedRootRef, graph);
  }
  return { effects: mergeViewEffects(...results.map((result) => result.effects),
    context.outputName ? { query: true, layout: true, render: true, persist: true } : null),
    focusCandidate: { focusedRootNodeIds, activeFocusedRootNodeId, outputName: null },
    commit() { for (const item of commands) bridge.dispatch(item.side, item.command); }
  };
}
