import { createPathIndex, checkPathBudget } from "../../analysis/path_query.js";
import { cellRole, fixedOutput, sourceIndex } from "./reconvergence_scope.js";
import { createGraphAliasIndex, expandGraphAliases } from "../../analysis/aliasNormalizer.js";
import { parseLibertyFunction } from "../../infer/liberty_function.js";
import { getPinConnectionEndpoints } from "../../netlist/pin_connections.js";

const indexes = new WeakMap();
const pinId = (id, pin) => JSON.stringify(["pin", id, pin]);
export const netPathKey = (net) => JSON.stringify(["net", net]);

function combinationalFunctions(node) {
  const info = node.libraryInfo;
  return !node.referencedModuleName && ["complex", "recognized", "constant", "interface-only", "unsupported"].includes(info?.logicStatus)
    && Object.keys(info.functions || {}).length ? info.functions : null;
}

export function netlistPathIndex(graph) {
  if (indexes.has(graph)) return indexes.get(graph);
  checkPathBudget(graph.nodes.length + graph.edges.length);
  const source = sourceIndex(graph), vertices = new Map(), arcs = [], cuts = [], endpoints = new Map(), drivers = new Map();
  const dependencies = new Map();
  const addEndpoint = (key, label, kind, starts, ends = starts) =>
    endpoints.set(key, { key, label, kind, starts, ends });
  const addDriver = (net, id) => {
    if (!drivers.has(net)) drivers.set(net, new Set());
    drivers.get(net).add(id);
  };
  for (const node of graph.nodes) {
    const id = node.id, label = node.ref?.instance || node.ref?.name || node.label || id;
    if (node.kind !== "cell") {
      vertices.set(id, { id, displayId: id, label, boundary: ["input", "output", "constant"].includes(node.kind) ? node.kind : null, issue: node.kind === "implicit" ? "missing-driver" :
        node.ref?.direction === "inout" ? "ambiguous-pin-direction" : null });
      addEndpoint(id, label, node.kind, [id]);
      if (node.kind === "input") addDriver(node.ref.name, id);
      continue;
    }
    const inputs = [], outputs = [];
    const functions = combinationalFunctions(node);
    const gate = !functions && cellRole(node) === "gate";
    const inputPins = new Map(), outputPorts = new Map();
    const body = JSON.stringify(["gate", id]);
    if (gate) vertices.set(body, { id: body, label });
    for (const port of node.portDescriptors || []) {
      if (["power", "internal"].includes(port.role)) continue;
      const pin = pinId(id, port.pin);
      if (vertices.has(pin)) continue;
      const input = source.canUse(node, port.pin, "input");
      const output = source.canUse(node, port.pin, "output");
      const name = label + "." + port.pin;
      const fixed = fixedOutput(node, port.pin);
      vertices.set(pin, { id: pin, displayId: id, label: name, cost: Number(output && gate && !fixed),
        boundary: gate || functions ? null : node.referencedModuleName ? "module" : node.gateKind,
        issue: input || output ? null : "ambiguous-pin-direction" });
      addEndpoint(pin, name, "pin", [pin]);
      if (input) { inputs.push(pin); inputPins.set(port.pin, pin); }
      if (output) { outputs.push(pin); outputPorts.set(pin, port); }
      if (gate && input) arcs.push({ source: pin, target: body });
      if (gate && output && !fixed) arcs.push({ source: body, target: pin });
    }
    if (gate) for (const pin of outputs) {
      if (!fixedOutput(node, outputPorts.get(pin).pin)) dependencies.set(pin, inputs);
    }
    if (functions) {
      const names = new Set(inputPins.keys());
      const unknownOutputs = [];
      for (const [id, port] of outputPorts) {
        const expression = functions[port.pin] ?? functions[port.rawPin];
        if (typeof expression !== "string") { unknownOutputs.push(id); continue; }
        const vertex = vertices.get(id);
        try {
          const parsed = parseLibertyFunction(expression, names);
          vertex.cost = Number(parsed.names.length > 0);
          vertex.boundary = parsed.names.length ? null : "constant";
          const pins = parsed.names.map((name) => inputPins.get(name));
          dependencies.set(id, pins);
          for (const pin of pins) arcs.push({ source: pin, target: id });
        } catch { unknownOutputs.push(id); }
      }
      if (unknownOutputs.length) {
        // One uncertainty junction bounds the work for cells with many pins.
        // Cuts qualify coverage without admitting an unproven path or level.
        const issue = "unknown-output-function";
        vertices.set(body, { id: body, label });
        for (const pin of inputs) cuts.push({ source: pin, target: body, issue });
        for (const pin of unknownOutputs) {
          vertices.get(pin).issue = issue;
          cuts.push({ source: body, target: pin, issue });
        }
      }
    }
    for (const pin of node.ref?.pins || []) for (const conn of getPinConnectionEndpoints(pin)) {
      if (source.canUse(node, conn.pin, "output")) addDriver(conn.name, pinId(id, conn.pin));
    }
    addEndpoint(id, label, gate || functions ? "cell" : node.gateKind || "boundary",
      outputs.sort(), gate || functions ? outputs : inputs.sort());
    checkPathBudget(vertices.size + arcs.length + cuts.length + endpoints.size);
  }
  for (const edge of graph.edges) {
    const driver = source.nodes.get(edge.source), load = source.nodes.get(edge.target);
    const from = driver.kind === "cell" ? pinId(driver.id, edge.sourcePin) : driver.id;
    const to = load.kind === "cell" ? pinId(load.id, edge.targetPin) : load.id;
    if (!vertices.has(from) || !vertices.has(to)) continue;
    addDriver(edge.net, from);
    const issue = source.uncertain(edge) ? "multiple-drivers" : source.driverIssue(driver, edge.sourcePin)
      || (!source.canUse(load, edge.targetPin, "input") && "ambiguous-pin-direction");
    if (issue) {
      vertices.get(to).issue = issue;
      cuts.push({ source: from, target: to, issue });
      continue;
    }
    arcs.push({ source: from, target: to, wire: edge.id });
  }
  // Folded assign names designate the same driver. Visible assign nodes
  // already have their own zero-cost connection.
  if (graph.aliases?.length) {
    const index = createGraphAliasIndex(graph), seen = new Set();
    for (const name of index.keys()) {
      if (seen.has(name)) continue;
      const names = expandGraphAliases([name], index), pins = new Set();
      for (const alias of names) {
        seen.add(alias);
        for (const id of drivers.get(alias) || []) pins.add(id);
      }
      for (const alias of names) drivers.set(alias, pins);
    }
  }
  const endpointPins = new Map();
  for (const [net, pins] of drivers) {
    if (!endpointPins.has(pins)) endpointPins.set(pins, [...pins].sort());
    const key = netPathKey(net);
    addEndpoint(key, net, "net", endpointPins.get(pins));
    endpoints.get(key).copyName = net;
    if (pins.size > 1) endpoints.get(key).issue = "multiple-drivers";
  }
  const topology = createPathIndex([...vertices.values()], arcs, endpoints, cuts);
  let previous, cached;
  const index = { endpoints, query(value) {
    const path = topology.query(value);
    if (!path || path === previous) return path ? cached : null;
    const searchKeys = new Set(), nets = new Set();
    for (const id of path.nodeIds) {
      const node = source.nodes.get(id);
      const kind = ["input", "output"].includes(node.kind) ? "port" : node.kind;
      searchKeys.add(JSON.stringify([kind, node.ref?.instance || node.ref?.name || node.label]));
    }
    const activePins = new Map();
    for (const [name, pins] of drivers) {
      if (!activePins.has(pins)) activePins.set(pins, endpointPins.get(pins).some((pin) => path.levels.has(pin)));
      if (activePins.get(pins)) {
        searchKeys.add(netPathKey(name)); nets.add(name);
      }
    }
    const usedDependencies = new Set(), sideInputPins = new Set();
    for (const id of path.levels.keys()) {
      const pins = dependencies.get(id);
      if (!pins || usedDependencies.has(pins)) continue;
      usedDependencies.add(pins);
      for (const pin of pins) sideInputPins.add(pin);
    }
    previous = path;
    cached = { ...path, searchKeys, nets, sideInputPins };
    return cached;
  } };
  indexes.set(graph, index);
  return index;
}

export function addPathSideInputs(full, graph, path) {
  const visible = new Set(graph.nodes.map((n) => n.id));
  const nodes = [...graph.nodes], edges = [...graph.edges], boundaries = new Map();
  for (const edge of full.edges) {
    if (!visible.has(edge.target) || path.edgeIds.has(edge.id) || !path.sideInputPins.has(pinId(edge.target, edge.targetPin))) continue;
    const key = JSON.stringify([edge.source, edge.sourcePin, edge.net]);
    let id = boundaries.get(key);
    if (!id) {
      id = "path-input:" + key;
      boundaries.set(key, id);
      nodes.push({ id, kind: "focus-input", label: edge.label || edge.net, title: "PATH INPUT", subtitle: "Show Path boundary",
        boundaryDirection: "in", ref: { name: edge.net, displayName: edge.label || edge.net } });
    }
    edges.push({ ...edge, id: "path-input:" + edge.id, source: id, sourcePin: edge.net });
  }
  return { ...graph, nodes, edges };
}
