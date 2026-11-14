import { immutableSnapshot } from "../foundation/immutable_snapshot.js";
import { readonlyCollection } from "../foundation/readonly_collection.js";

export const MEASURED_GRAPH_CONTRACT = "measured-layout-graph.v1";
const SIDES = new Set(["left", "right", "top", "bottom"]);
const DIRECTIONS = new Set(["input", "output", "inout"]);

/** Geometry is supplied by a domain adapter, never inferred by a layout provider. */
export function createMeasuredLayoutGraph(diagram, measurements) {
  if (!Array.isArray(diagram?.nodes) || !Array.isArray(diagram?.edges)) throw new Error("Measured graph requires diagram nodes and edges");
  if (!(measurements?.nodes instanceof Map)) throw new Error("Measured graph requires node measurements");
  const nodes = new Map();
  const seen = new WeakMap();
  for (const node of diagram.nodes) {
    if (typeof node.id !== "string" || !node.id || nodes.has(node.id)) throw new Error(`Invalid measured node id: ${node.id}`);
    const geometry = measurements.nodes.get(node.id);
    if (!geometry || !positive(geometry.width) || !positive(geometry.height)) throw new Error(`Measured node requires finite positive dimensions: ${node.id}`);
    const ids = new Set();
    const ports = (geometry.ports || []).map((port) => {
      if (typeof port.id !== "string" || !port.id || ids.has(port.id)) throw new Error(`Invalid measured port id on ${node.id}: ${port.id}`);
      ids.add(port.id);
      if (!SIDES.has(port.side) || !DIRECTIONS.has(port.direction) || !Number.isFinite(port.x) || !Number.isFinite(port.y)) {
        throw new Error(`Invalid measured port geometry: ${node.id}/${port.id}`);
      }
      // Own the flat geometry record once. Only optional metadata needs the
      // general recursive snapshot path; symbols/functions remain rejected.
      const copy = { ...port };
      if (Object.getOwnPropertySymbols(copy).length) throw new TypeError("Session snapshots do not support Symbol properties");
      for (const key of Object.keys(copy)) copy[key] = immutableSnapshot(copy[key], {}, seen);
      return Object.freeze(copy);
    });
    const offsets = geometry.connectionOffsets || {};
    const connectionOffsets = {};
    for (const role of ["source", "target"]) {
      const offset = offsets[role] || { x: 0, y: 0 };
      if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) throw new Error(`Invalid measured connection offset: ${node.id}/${role}`);
      connectionOffsets[role] = Object.freeze({ x: offset.x, y: offset.y });
    }
    const portLayout = geometry.portLayout || { mode: "fixed" };
    if (!["fixed", "side-distributed"].includes(portLayout.mode) ||
        (portLayout.mode === "side-distributed" && portLayout.pitch !== null && !positive(portLayout.pitch))) throw new Error(`Invalid measured port layout: ${node.id}`);
    nodes.set(node.id, Object.freeze({ width: geometry.width, height: geometry.height,
      ports: Object.freeze(ports), connectionOffsets: Object.freeze(connectionOffsets),
      portLayout: immutableSnapshot(portLayout, {}, seen) }));
  }
  if (nodes.size !== measurements.nodes.size) throw new Error("Measured graph contains unknown node measurements");
  return Object.freeze({ contract: MEASURED_GRAPH_CONTRACT, diagram,
    measurements: Object.freeze({ nodes: readonlyCollection(nodes),
      orderGroups: immutableSnapshot(measurements.orderGroups || [], {}, seen) }) });
}

function positive(value) { return Number.isFinite(value) && value > 0; }
