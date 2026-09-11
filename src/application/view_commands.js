import { isObjectRef, objectRefKey } from "../contracts/object_ref.js";
import { DEFAULT_FOCUSED_VIEW_POLICY, normalizeMaximumRoots } from "../foundation/view_policy.js";
import { areStructuredValuesEqual } from "../foundation/structured_value.js";

const NO_EFFECTS = Object.freeze({ query: false, layout: false, render: false, viewport: false, persist: false });

export function createViewCommandHandlers({
  sessions,
  maxFocusedRoots = DEFAULT_FOCUSED_VIEW_POLICY.maximumRoots
}) {
  const focusedRootLimit = normalizeMaximumRoots(maxFocusedRoots);
  const withSession = (command, decide, options = {}) => {
    if (!command.sessionId) throw new Error(`${command.type} requires sessionId`);
    const current = sessions.require(command.sessionId);
    const outcome = decide(current, command) || {};
    const session = outcome.patch
      ? sessions.update(command.sessionId, () => outcome.patch, {
        invalidateComputation: outcome.invalidateComputation ?? options.invalidateComputation
      })
      : current;
    return { session, rejected: outcome.rejected || null, effects: outcome.effects || NO_EFFECTS };
  };

  const focus = (type) => (command) => withSession(command, (session) => {
    const ref = requireSessionRef(session, command.objectRef);
    const roots = [...session.focusedRootRefs];
    const index = roots.findIndex((item) => objectRefKey(item) === objectRefKey(ref));
    if (type === "activate" && index < 0) return { rejected: "focused-root-missing", effects: NO_EFFECTS };
    if (type === "add" && index < 0 && roots.length >= focusedRootLimit) {
      return { rejected: "focused-root-capacity", effects: NO_EFFECTS };
    }
    if (type === "activate") {
      const changed = objectRefKeyOrNull(ref) !== objectRefKeyOrNull(session.activeFocusedRootRef);
      return {
        ...(changed ? { patch: { activeFocusedRootRef: ref } } : {}),
        invalidateComputation: false,
        effects: computeEffects({ render: true, viewport: true, persist: changed })
      };
    }
    let nextRoots = roots;
    if (type === "set") nextRoots = [ref];
    if (type === "add" && index < 0) nextRoots = [...roots, ref];
    if (type === "remove" && index >= 0) nextRoots = roots.filter((_, itemIndex) => itemIndex !== index);
    const active = type === "remove" ? chooseActive(nextRoots, session.activeFocusedRootRef) : ref;
    const nextViewMode = type === "remove"
      ? (nextRoots.length === 0 && session.viewMode === "focused" ? "whole" : session.viewMode)
      : "focused";
    const rootsChanged = !sameRefs(roots, nextRoots);
    const activeChanged = objectRefKeyOrNull(active) !== objectRefKeyOrNull(session.activeFocusedRootRef);
    const viewModeChanged = nextViewMode !== session.viewMode;
    const changed = rootsChanged || activeChanged || viewModeChanged;
    const invalidatesComputation = viewModeChanged || (rootsChanged && session.viewMode === "focused") ||
      (rootsChanged && type !== "remove");
    const effects = invalidatesComputation
      ? computeEffects({ query: true, layout: true, render: true, persist: true })
      : computeEffects({ render: changed, viewport: activeChanged, persist: changed });
    return changed ? {
      patch: { focusedRootRefs: nextRoots, activeFocusedRootRef: active, viewMode: nextViewMode },
      invalidateComputation: invalidatesComputation,
      effects
    } : { effects: NO_EFFECTS };
  });

  return Object.freeze({
    "unit.set": (command) => withSession(command, (session) => {
      const unitId = requireId(command.unitId, "unitId");
      const viewMode = requireViewMode(command.viewMode || "whole");
      if (unitId === session.unitId && viewMode === session.viewMode) return { effects: NO_EFFECTS };
      return {
        patch: {
          unitId,
          viewMode,
          focusedRootRefs: [],
          activeFocusedRootRef: null,
          selectedObjectRef: null,
          overrides: null,
          viewport: { x: 0, y: 0, scale: 1 }
        },
        effects: computeEffects({ query: true, layout: true, render: true, viewport: true, persist: true })
      };
    }),
    "focus.add": focus("add"),
    "focus.set": focus("set"),
    "focus.remove": focus("remove"),
    "focus.activate": focus("activate"),
    "focus.replace": (command) => withSession(command, (session) => {
      const roots = (command.objectRefs || []).map((ref) => requireSessionRef(session, ref));
      const unique = roots.filter((ref, index) => roots.findIndex((item) => objectRefKey(item) === objectRefKey(ref)) === index);
      if (unique.length > focusedRootLimit) return { rejected: "focused-root-capacity", effects: NO_EFFECTS };
      const requestedActive = command.activeObjectRef
        ? requireSessionRef(session, command.activeObjectRef)
        : null;
      const activeKey = objectRefKeyOrNull(requestedActive);
      const active = unique.find((ref) => objectRefKey(ref) === activeKey) || unique[0] || null;
      const nextViewMode = unique.length > 0
        ? "focused"
        : session.viewMode === "focused" ? "whole" : session.viewMode;
      const changed = !sameRefs(session.focusedRootRefs, unique) ||
        objectRefKeyOrNull(active) !== objectRefKeyOrNull(session.activeFocusedRootRef) ||
        nextViewMode !== session.viewMode;
      if (!changed) return { effects: NO_EFFECTS };
      return {
        patch: {
          focusedRootRefs: unique,
          activeFocusedRootRef: active,
          viewMode: nextViewMode
        },
        effects: computeEffects({ query: true, layout: true, render: true, persist: true })
      };
    }),
    "focus.clear": (command) => withSession(command, (session) => {
      const nextViewMode = session.viewMode === "focused" ? "whole" : session.viewMode;
      const changed = session.focusedRootRefs.length > 0 || session.activeFocusedRootRef || nextViewMode !== session.viewMode;
      if (!changed) return { effects: NO_EFFECTS };
      const invalidatesComputation = session.viewMode === "focused";
      return {
        patch: { focusedRootRefs: [], activeFocusedRootRef: null, viewMode: nextViewMode },
        invalidateComputation: invalidatesComputation,
        effects: invalidatesComputation
          ? computeEffects({ query: true, layout: true, render: true, persist: true })
          : computeEffects({ render: true, persist: true })
      };
    }),
    "selection.set": (command) => withSession(command, (session) => {
      const selectedObjectRef = requireSessionRef(session, command.objectRef);
      if (objectRefKeyOrNull(selectedObjectRef) === objectRefKeyOrNull(session.selectedObjectRef)) {
        return { effects: NO_EFFECTS };
      }
      return {
        patch: { selectedObjectRef },
        invalidateComputation: false,
        effects: computeEffects({ render: true })
      };
    }),
    "selection.clear": (command) => withSession(command, (session) => session.selectedObjectRef ? ({
      patch: { selectedObjectRef: null },
      invalidateComputation: false,
      effects: computeEffects({ render: true })
    }) : ({ effects: NO_EFFECTS })),
    "view.mode.set": (command) => withSession(command, (session) => {
      const viewMode = requireViewMode(command.viewMode);
      if (viewMode === "focused" && session.focusedRootRefs.length === 0) {
        return { rejected: "focused-root-missing", effects: NO_EFFECTS };
      }
      return viewMode === session.viewMode ? { effects: NO_EFFECTS } : {
        patch: { viewMode },
        effects: computeEffects({ query: true, layout: true, render: true, viewport: true, persist: true })
      };
    }),
    "view.depths.set": (command) => withSession(command, (session) => {
      const faninDepth = requireDepth(command.faninDepth, "faninDepth");
      const fanoutDepth = requireDepth(command.fanoutDepth, "fanoutDepth");
      if (faninDepth === session.faninDepth && fanoutDepth === session.fanoutDepth) return { effects: NO_EFFECTS };
      return {
        patch: { faninDepth, fanoutDepth },
        effects: computeEffects({ query: true, layout: true, render: true, persist: true })
      };
    }),
    "viewport.set": (command) => {
      if (!command.sessionId) throw new Error(`${command.type} requires sessionId`);
      const viewport = requireViewport(command.viewport);
      const current = sessions.require(command.sessionId);
      if (sameViewport(current.viewport, viewport)) {
        return { session: current, rejected: null, effects: NO_EFFECTS };
      }
      return {
        session: sessions.updateViewport(command.sessionId, viewport),
        rejected: null,
        effects: computeEffects({ viewport: true, persist: true })
      };
    },
    "layout.policy.set": (command) => withSession(command, (session) => {
      const layoutPolicy = requireRecord(command.layoutPolicy, "layoutPolicy");
      return areStructuredValuesEqual(session.layoutPolicy, layoutPolicy) ? { effects: NO_EFFECTS } : {
        patch: { layoutPolicy },
        effects: computeEffects({ layout: true, render: true, persist: true })
      };
    }),
    "overrides.set": (command) => withSession(command, (session) => {
      const overrides = command.overrides ?? null;
      return areStructuredValuesEqual(session.overrides, overrides) ? { effects: NO_EFFECTS } : {
        patch: { overrides },
        effects: computeEffects({ render: true, persist: true })
      };
    }),
    "selection.reveal": (command) => withSession(command, (session) => {
      const ref = requireDocumentRef(session, command.objectRef);
      const visible = new Set(command.visibleObjectKeys || []).has(objectRefKey(ref));
      if (ref.unitId === session.unitId && visible) {
        const selected = objectRefKeyOrNull(ref) === objectRefKeyOrNull(session.selectedObjectRef);
        return {
          ...(selected ? {} : { patch: { selectedObjectRef: ref } }),
          invalidateComputation: false,
          effects: computeEffects({ viewport: true })
        };
      }
      const sameUnit = ref.unitId === session.unitId;
      const roots = sameUnit && session.viewMode === "focused" ? [...session.focusedRootRefs] : [];
      if (!roots.some((item) => objectRefKey(item) === objectRefKey(ref))) {
        if (roots.length >= focusedRootLimit) return { rejected: "focused-root-capacity", effects: NO_EFFECTS };
        roots.push(ref);
      }
      return {
        patch: {
          unitId: ref.unitId,
          viewMode: "focused",
          focusedRootRefs: roots,
          activeFocusedRootRef: ref,
          selectedObjectRef: ref
        },
        effects: computeEffects({ query: true, layout: true, render: true, viewport: true, persist: true })
      };
    })
  });
}

function requireViewport(value) {
  const viewport = { x: Number(value?.x), y: Number(value?.y), scale: Number(value?.scale) };
  if (!Object.values(viewport).every(Number.isFinite) || viewport.scale <= 0) {
    throw new Error("Command requires a finite positive viewport");
  }
  return viewport;
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Command requires ${label}`);
  return value;
}

function requireId(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Command requires ${label}`);
  return value;
}

function requireViewMode(value) {
  if (!["whole", "focused", "search-first"].includes(value)) throw new Error("Command requires a valid viewMode");
  return value;
}

function requireDepth(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Command requires finite ${label}`);
  return Math.min(99, Math.max(0, Math.floor(number)));
}

function requireDocumentRef(session, ref) {
  if (!isObjectRef(ref)) throw new Error("Command requires objectRef");
  if (ref.documentId !== session.documentId) throw new Error("ObjectRef belongs to another document");
  return ref;
}

function requireSessionRef(session, ref) {
  requireDocumentRef(session, ref);
  if (ref.unitId !== session.unitId) throw new Error("ObjectRef belongs to another unit");
  return ref;
}

function computeEffects(overrides = {}) {
  return Object.freeze({ ...NO_EFFECTS, ...overrides });
}

function sameRefs(left, right) {
  return left.length === right.length && left.every((ref, index) => objectRefKey(ref) === objectRefKey(right[index]));
}

function sameViewport(left, right) {
  return left?.x === right?.x && left?.y === right?.y && left?.scale === right?.scale;
}

function chooseActive(roots, active) {
  const activeKey = objectRefKeyOrNull(active);
  return roots.find((ref) => objectRefKey(ref) === activeKey) || roots[0] || null;
}

function objectRefKeyOrNull(ref) {
  return ref ? objectRefKey(ref) : null;
}
