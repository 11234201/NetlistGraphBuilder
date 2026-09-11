import { isObjectRef, objectRefKey } from "../contracts/object_ref.js";

const NO_EFFECTS = Object.freeze({ query: false, layout: false, render: false, viewport: false, persist: false });

export function createViewCommandHandlers({ sessions, maxFocusedRoots = 8 }) {
  const withSession = (command, decide) => {
    if (!command.sessionId) throw new Error(`${command.type} requires sessionId`);
    let outcome;
    const session = sessions.update(command.sessionId, (current) => {
      outcome = decide(current, command);
      return outcome.patch || current;
    });
    return { session, rejected: outcome.rejected || null, effects: outcome.effects || NO_EFFECTS };
  };

  const focus = (type) => (command) => withSession(command, (session) => {
    const ref = requireSessionRef(session, command.objectRef);
    const roots = [...session.focusedRootRefs];
    const index = roots.findIndex((item) => objectRefKey(item) === objectRefKey(ref));
    if (type === "activate" && index < 0) return { rejected: "focused-root-missing", effects: NO_EFFECTS };
    if (type === "add" && index < 0 && roots.length >= maxFocusedRoots) {
      return { rejected: "focused-root-capacity", effects: NO_EFFECTS };
    }
    let nextRoots = roots;
    if (type === "set") nextRoots = [ref];
    if (type === "add" && index < 0) nextRoots = [...roots, ref];
    if (type === "remove" && index >= 0) nextRoots = roots.filter((_, itemIndex) => itemIndex !== index);
    const active = type === "remove"
      ? chooseActive(nextRoots, session.activeFocusedRootRef)
      : ref;
    const changed = !sameRefs(roots, nextRoots) || objectRefKeyOrNull(active) !== objectRefKeyOrNull(session.activeFocusedRootRef);
    const effects = type === "activate"
      ? computeEffects({ render: true, viewport: true, persist: true })
      : computeEffects({ query: true, layout: true, render: true, persist: true });
    return changed ? {
      patch: { focusedRootRefs: nextRoots, activeFocusedRootRef: active, viewMode: "focused" },
      effects
    } : { effects: NO_EFFECTS };
  });

  return Object.freeze({
    "focus.add": focus("add"),
    "focus.set": focus("set"),
    "focus.remove": focus("remove"),
    "focus.activate": focus("activate"),
    "selection.set": (command) => withSession(command, (session) => ({
      patch: { selectedObjectRef: requireSessionRef(session, command.objectRef) },
      effects: computeEffects({ render: true })
    })),
    "selection.clear": (command) => withSession(command, () => ({
      patch: { selectedObjectRef: null },
      effects: computeEffects({ render: true })
    })),
    "viewport.set": (command) => {
      if (!command.sessionId) throw new Error(`${command.type} requires sessionId`);
      const viewport = requireViewport(command.viewport);
      return {
        session: sessions.updateViewport(command.sessionId, viewport),
        rejected: null,
        effects: computeEffects({ viewport: true, persist: true })
      };
    },
    "layout.policy.set": (command) => withSession(command, () => ({
      patch: { layoutPolicy: requireRecord(command.layoutPolicy, "layoutPolicy") },
      effects: computeEffects({ layout: true, render: true, persist: true })
    })),
    "overrides.set": (command) => withSession(command, () => ({
      patch: { overrides: command.overrides ?? null },
      effects: computeEffects({ render: true, persist: true })
    })),
    "selection.reveal": (command) => withSession(command, (session) => {
      const ref = requireDocumentRef(session, command.objectRef);
      const visible = new Set(command.visibleObjectKeys || []).has(objectRefKey(ref));
      if (ref.unitId === session.unitId && visible) {
        return { patch: { selectedObjectRef: ref }, effects: computeEffects({ viewport: true }) };
      }
      const sameUnit = ref.unitId === session.unitId;
      const roots = sameUnit && session.viewMode === "focused" ? [...session.focusedRootRefs] : [];
      if (!roots.some((item) => objectRefKey(item) === objectRefKey(ref))) {
        if (roots.length >= maxFocusedRoots) return { rejected: "focused-root-capacity", effects: NO_EFFECTS };
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

function chooseActive(roots, active) {
  const activeKey = objectRefKeyOrNull(active);
  return roots.find((ref) => objectRefKey(ref) === activeKey) || roots[0] || null;
}

function objectRefKeyOrNull(ref) {
  return ref ? objectRefKey(ref) : null;
}
