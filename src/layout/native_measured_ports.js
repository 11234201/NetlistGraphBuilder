import { PhaseError, compareIds } from "./anchor_layered/protocol.js";
import { createNativePortIdEncoder } from "./native_port_ids.js";
import { getPort } from "./nodeGeometry.js";

export function createMeasuredNativePorts(nodes, policy) {
  const encode = createNativePortIdEncoder(nodes);
  const byId = new Map();
  const portsByNode = new Map();
  for (const node of nodes) {
    const ports = [];
    const vertical = [];
    const add = (port, role) => {
      const id = encode(node.id, port, role);
      const side = port?.side ?? (role === "source" ? "right" : "left");
      const offset = node.connectionOffsets[role];
      const x = (port?.x ?? (role === "source" ? node.width : 0)) + offset.x;
      const y = (port?.y ?? node.height / 2) + offset.y;
      if (!["left", "right", "top", "bottom"].includes(side)) {
        throw new PhaseError("adapter", "invalid-port-side", [id], side);
      }
      const projected = side === "top" || side === "bottom";
      const east = projected ? role === "source" : side === "right";
      const native = { id, side: east ? "EAST" : "WEST", x, y, width: 0, height: 0,
        borderOffset: east ? x - node.width : -x };
      if (projected) vertical.push({ side, native });
      ports.push(native);
      byId.set(id, { native, projected });
    };
    if (node.ports.length) {
      for (const port of node.ports) {
        if (port.direction !== "input") add(port, "source");
        if (port.direction !== "output") add(port, "target");
      }
    } else {
      add(null, "source");
      add(null, "target");
    }
    // Reserve a distinct horizontal track outside the body for each vertical
    // pin. The layered router includes these tracks in the node margins.
    vertical.sort((a, b) => compareIds(a.native.id, b.native.id));
    let top = 0, bottom = node.height;
    for (const { side, native } of vertical) {
      if (side === "top") top = Math.min(top, native.y);
      else bottom = Math.max(bottom, native.y);
    }
    let topCount = 0, bottomCount = 0;
    for (const { side, native } of vertical) {
      native.y = side === "top"
        ? top - policy.edgeNodeSpacing - topCount++ * policy.edgeEdgeSpacing
        : bottom + policy.edgeNodeSpacing + bottomCount++ * policy.edgeEdgeSpacing;
    }
    portsByNode.set(node.id, ports);
  }
  return {
    portsByNode,
    endpoint(node, pin, role) {
      const port = getPort(node, pin, role);
      const id = encode(node.id, port, role);
      const entry = byId.get(id);
      if (!entry) throw new PhaseError("adapter", "missing-endpoint-port", [id]);
      return entry;
    }
  };
}
