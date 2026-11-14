import { immutableSnapshot } from "../foundation/immutable_snapshot.js";
import { cloneGraphOverrides } from "../domains/netlist/graph_overrides.js";

export const SINGLE_VIEW_STATE_FIELDS = Object.freeze([
  "transform", "layoutPolicy", "presentationPolicy", "nodePositions", "nodeSizes", "graphOverrides"
]);
export const COMPARE_VIEW_STATE_FIELDS = Object.freeze(["transforms", "nodePositions", "nodeSizes", "graphOverrides"]);

// Decode legacy snapshot fields only at an explicit import boundary. Normal
// commands consume ViewSession values and never reconstruct them from projections.
export function importViewState(value = {}, current = {}) {
  const patch = {};
  if (value.viewport !== undefined || value.transform !== undefined) patch.viewport = value.viewport ?? value.transform;
  for (const key of ["layoutPolicy", "presentationPolicy"]) if (value[key] !== undefined) patch[key] = value[key];
  if (value.overrides !== undefined || ["nodePositions", "nodeSizes", "graphOverrides"].some((key) => value[key] !== undefined)) {
    const source = value.overrides === null ? {} : value.overrides || { ...current.overrides, ...value };
    patch.overrides = {
      nodePositions: new Map(source.nodePositions || []),
      nodeSizes: new Map(source.nodeSizes || []),
      graphOverrides: cloneGraphOverrides(source.graphOverrides)
    };
  }
  return immutableSnapshot(patch);
}

const EMPTY_STATE = immutableSnapshot({ viewport: { x: 0, y: 0, scale: 1 }, layoutPolicy: {}, presentationPolicy: {},
  overrides: { nodePositions: new Map(), nodeSizes: new Map(), graphOverrides: cloneGraphOverrides() } });

export function initialViewState(value = {}) {
  return immutableSnapshot({ ...EMPTY_STATE, ...importViewState(value) });
}

export function projectViewState(state, session) {
  state.transform = session.viewport;
  state.layoutPolicy = session.layoutPolicy;
  state.presentationPolicy = session.presentationPolicy;
  const overrides = session.overrides || EMPTY_STATE.overrides;
  state.nodePositions = overrides.nodePositions;
  state.nodeSizes = overrides.nodeSizes;
  state.graphOverrides = overrides.graphOverrides;
}

export function compareSideViewState(value, side) {
  return {
    ...(value.transforms?.[side] ? { viewport: value.transforms[side] } : {}),
    ...(value.overrides?.[side] ? { overrides: value.overrides[side] } : {}),
    ...Object.fromEntries(["nodePositions", "nodeSizes", "graphOverrides"].filter((key) => value[key]?.[side] !== undefined)
      .map((key) => [key, value[key][side]]))
  };
}

export function projectCompareViewState(compare, side, session) {
  const overrides = session.overrides || EMPTY_STATE.overrides;
  compare.transforms = Object.freeze({ ...compare.transforms, [side]: session.viewport });
  for (const key of ["nodePositions", "nodeSizes", "graphOverrides"]) {
    compare[key] = Object.freeze({ ...compare[key], [side]: overrides[key] });
  }
}
