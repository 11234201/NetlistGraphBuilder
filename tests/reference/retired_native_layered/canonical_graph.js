import { getPhysicalNetKey } from "../../../src/layout/layoutTopology.js";
import { buildNodePorts, measureNode } from "../../../src/layout/nodeGeometry.js";

/**
 * Build the immutable, provider-private input model for Native Layered.
 * Public graph objects are copied at this boundary and are never decorated by
 * later phases.  Every collection is canonical so downstream algorithms do
 * not observe parser or projection array order.
 */
export function BuildCanonicalGraph(graph = {}, options = {}) {
  const cellPinPitch = PositiveNumber(options.cellPinPitch, 36);
  const diagnostics = [];
  const nodeInputs = [...(graph.nodes || [])].sort(ComparePublicNodes);
  const duplicateNodeKeys = FindDuplicates(nodeInputs.map((node) => String(node?.id ?? "")));
  if (duplicateNodeKeys.size > 0) {
    for (const key of duplicateNodeKeys) {
      diagnostics.push(Freeze({ code: "native-layered-duplicate-node-key", nodeKey: key }));
    }
  }

  const nodes = [];
  const nodeByKey = new Map();
  for (const source of nodeInputs) {
    const key = String(source?.id ?? "");
    if (!key || nodeByKey.has(key)) continue;
    const measured = ReadSize(source, cellPinPitch);
    const ports = BuildCanonicalPorts(source, measured, cellPinPitch);
    const node = Freeze({
      key,
      publicId: source.id,
      kind: String(source.kind || "unknown"),
      stableName: StableObjectName(source),
      isFocusedRoot: source.isFocusedRoot === true,
      width: measured.width,
      height: measured.height,
      ports
    });
    nodes.push(node);
    nodeByKey.set(key, node);
  }

  const logicalEdges = [];
  const edgeByKey = new Map();
  const edgeInputs = [...(graph.edges || [])].sort(ComparePublicEdges);
  for (const source of edgeInputs) {
    const key = StableEdgeKey(source);
    if (edgeByKey.has(key)) {
      diagnostics.push(Freeze({ code: "native-layered-duplicate-edge-key", edgeKey: key }));
      continue;
    }
    const sourceNode = nodeByKey.get(String(source?.source ?? ""));
    const targetNode = nodeByKey.get(String(source?.target ?? ""));
    if (!sourceNode || !targetNode) {
      diagnostics.push(Freeze({
        code: "native-layered-missing-endpoint",
        edgeKey: key,
        sourceKey: String(source?.source ?? ""),
        targetKey: String(source?.target ?? "")
      }));
      continue;
    }
    const physicalNetKey = String(getPhysicalNetKey(source));
    const edge = Freeze({
      key,
      publicId: source.id,
      sourceKey: sourceNode.key,
      targetKey: targetNode.key,
      sourcePortKey: ResolvePortKey(sourceNode, source.sourcePin, "output"),
      targetPortKey: ResolvePortKey(targetNode, source.targetPin, "input"),
      sourcePin: source.sourcePin ?? null,
      targetPin: source.targetPin ?? null,
      physicalNetKey,
      minimumLength: PositiveInteger(source.minimumLength, 1)
    });
    logicalEdges.push(edge);
    edgeByKey.set(key, edge);
  }

  const physicalNets = BuildPhysicalNets(logicalEdges);
  const outgoingByNode = BuildAdjacency(nodes, logicalEdges, "sourceKey");
  const incomingByNode = BuildAdjacency(nodes, logicalEdges, "targetKey");
  const model = {
    nodes: Freeze(nodes),
    logicalEdges: Freeze(logicalEdges),
    physicalNets,
    diagnostics: Freeze(diagnostics),
    nodeByKey: ReadonlyMap(nodeByKey),
    edgeByKey: ReadonlyMap(edgeByKey),
    outgoingByNode,
    incomingByNode
  };
  return Freeze(model);
}

function BuildCanonicalPorts(node, size, cellPinPitch) {
  return Freeze(buildNodePorts(node, size, cellPinPitch)
    .map((port, index) => ({
      key: StablePortKey(node, port, index),
      pin: port.pin ?? null,
      rawPin: port.rawPin ?? null,
      direction: String(port.direction || "unknown"),
      side: String(port.side || "left"),
      order: Number.isFinite(Number(port.order)) ? Number(port.order) : index,
      x: Number(port.x) || 0,
      y: Number(port.y) || 0
    }))
    .sort(ComparePorts)
    .map(Freeze));
}

function BuildPhysicalNets(edges) {
  const groups = new Map();
  for (const edge of edges) {
    const list = groups.get(edge.physicalNetKey) || [];
    list.push(edge.key);
    groups.set(edge.physicalNetKey, list);
  }
  return Freeze([...groups.entries()]
    .sort(([left], [right]) => CompareText(left, right))
    .map(([key, edgeKeys]) => Freeze({ key, edgeKeys: Freeze(edgeKeys.sort(CompareText)) })));
}

function BuildAdjacency(nodes, edges, endpointField) {
  const result = new Map(nodes.map((node) => [node.key, []]));
  for (const edge of edges) result.get(edge[endpointField])?.push(edge.key);
  for (const [key, values] of result) result.set(key, Freeze(values.sort(CompareText)));
  return ReadonlyMap(result);
}

function ResolvePortKey(node, pin, direction) {
  const exact = node.ports.find((port) =>
    port.direction === direction && (port.pin === pin || port.rawPin === pin));
  return (exact || node.ports.find((port) => port.direction === direction) || node.ports[0])?.key ?? null;
}

function StablePortKey(node, port, fallbackOrder) {
  const side = String(port.side || "left");
  const direction = String(port.direction || "unknown");
  const pin = String(port.rawPin ?? port.pin ?? "");
  return `${String(node.id)}\u0000${side}\u0000${direction}\u0000${pin}\u0000${fallbackOrder}`;
}

function StableEdgeKey(edge) {
  const explicit = String(edge?.id ?? "");
  if (explicit) return explicit;
  return [edge?.source, edge?.sourcePin, edge?.target, edge?.targetPin, getPhysicalNetKey(edge)]
    .map((value) => String(value ?? ""))
    .join("\u0000");
}

function StableObjectName(node) {
  return String(node?.ref?.canonicalName ?? node?.ref?.name ?? node?.label ?? node?.id ?? "");
}

function ReadSize(node, cellPinPitch) {
  if (Number.isFinite(Number(node?.width)) && Number.isFinite(Number(node?.height))) {
    return Freeze({ width: Number(node.width), height: Number(node.height) });
  }
  return Freeze(measureNode(node, cellPinPitch));
}

function ComparePublicNodes(left, right) {
  return CompareText(left?.id, right?.id) || CompareText(StableObjectName(left), StableObjectName(right));
}

function ComparePublicEdges(left, right) {
  return CompareText(StableEdgeKey(left), StableEdgeKey(right)) ||
    CompareText(left?.source, right?.source) || CompareText(left?.target, right?.target);
}

function ComparePorts(left, right) {
  return SideOrder(left.side) - SideOrder(right.side) || left.order - right.order || CompareText(left.key, right.key);
}

function SideOrder(side) {
  return ({ left: 0, top: 1, bottom: 2, right: 3 })[side] ?? 4;
}

function FindDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) (seen.has(value) ? duplicates : seen).add(value);
  return duplicates;
}

function ReadonlyMap(map) {
  // Map values are immutable and the map itself is kept provider-private.
  // Freezing documents ownership even though JavaScript cannot disable Map#set.
  return Object.freeze(map);
}

function Freeze(value) {
  return Object.freeze(value);
}

function CompareText(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function PositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function PositiveInteger(value, fallback) {
  return Math.max(1, Math.floor(PositiveNumber(value, fallback)));
}
