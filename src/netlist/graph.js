import { inferCellKind, inferPinDirection } from "../infer/defaultCellRules.js";
import { getNetDisplayName, getPortDisplayName } from "./model.js";

export function buildSchematicGraph(module) {
  const graph = {
    moduleName: module.name,
    moduleDisplayName: module.displayName,
    nodes: [],
    edges: [],
    diagnostics: [...module.diagnostics],
    stats: {
      ports: module.ports.length,
      nets: module.nets.length,
      cells: module.cells.length,
      assigns: module.assigns.length
    }
  };

  const nodeById = new Map();
  const drivers = new Map();
  const loads = new Map();

  const addNode = (node) => {
    if (!nodeById.has(node.id)) {
      nodeById.set(node.id, node);
      graph.nodes.push(node);
    }
    return nodeById.get(node.id);
  };

  const addLoad = (net, load) => {
    if (!loads.has(net)) {
      loads.set(net, []);
    }
    loads.get(net).push(load);
  };

  for (const [order, port] of module.ports.entries()) {
    if (port.direction === "input" || port.direction === "inout") {
      const node = addNode({
        id: makeId("input", port.name),
        kind: "input",
        label: port.displayName,
        title: "INPUT",
        order,
        ref: port
      });
      drivers.set(port.name, {
        nodeId: node.id,
        pin: port.displayName,
        source: "port"
      });
    }

    if (port.direction === "output" || port.direction === "inout") {
      const node = addNode({
        id: makeId("output", port.name),
        kind: "output",
        label: port.displayName,
        title: "OUTPUT",
        order,
        ref: port
      });
      addLoad(port.name, {
        nodeId: node.id,
        pin: port.displayName,
        source: "port"
      });
    }
  }

  for (const cell of module.cells) {
    const cellKind = inferCellKind(cell.type);
    const node = addNode({
      id: makeId("cell", cell.instance),
      kind: "cell",
      gateKind: cellKind.kind,
      inferenceSource: cellKind.source,
      label: cell.instanceDisplayName || cell.instance,
      title: cellKind.kind.toUpperCase(),
      subtitle: cell.typeDisplayName || cell.type,
      ref: cell
    });

    for (const pin of cell.pins) {
      if (!pin.net) {
        continue;
      }
      const pinDirection = inferPinDirection(pin.pin);
      if (pinDirection.direction === "output") {
        drivers.set(pin.net, {
          nodeId: node.id,
          pin: pin.pinDisplayName || pin.pin,
          source: "cell"
        });
      } else {
        addLoad(pin.net, {
          nodeId: node.id,
          pin: pin.pinDisplayName || pin.pin,
          source: "cell"
        });
      }
    }
  }

  for (const assign of module.assigns) {
    const node = addNode({
      id: makeId("assign", `${assign.lhs}:${assign.rhs}`),
      kind: "assign",
      gateKind: "buf",
      inferenceSource: "fallback",
      label: assign.lhsDisplayName || assign.lhs,
      title: "BUF",
      subtitle: "assign",
      ref: assign
    });

    addLoad(assign.rhs, {
      nodeId: node.id,
      pin: "I",
      source: "assign"
    });
    drivers.set(assign.lhs, {
      nodeId: node.id,
      pin: "Z",
      source: "assign"
    });
  }

  for (const [net, netLoads] of loads.entries()) {
    const driver = drivers.get(net) || createImplicitDriver(module, graph, addNode, net);
    for (const load of netLoads) {
      if (driver.nodeId === load.nodeId) {
        continue;
      }
      graph.edges.push({
        id: makeId("edge", `${driver.nodeId}:${load.nodeId}:${net}:${graph.edges.length}`),
        source: driver.nodeId,
        target: load.nodeId,
        net,
        label: getNetDisplayName(module, net),
        sourcePin: driver.pin,
        targetPin: load.pin
      });
    }
  }

  return graph;
}

function createImplicitDriver(module, graph, addNode, net) {
  const constant = isConstantNet(net);
  const kind = constant ? "constant" : "implicit";
  const node = addNode({
    id: makeId(kind, net),
    kind,
    label: getNetDisplayName(module, net),
    title: constant ? "CONST" : "IMPLICIT",
    order: -1,
    ref: { name: net, displayName: getNetDisplayName(module, net) }
  });

  if (!constant) {
    graph.diagnostics.push({
      severity: "warning",
      message: `Net ${getNetDisplayName(module, net)} has no explicit driver`
    });
  }

  return {
    nodeId: node.id,
    pin: getPortDisplayName(module, net),
    source: kind
  };
}

function isConstantNet(net) {
  return /^(\d+)?'[bdho][0-9a-fxz_]+$/i.test(net) || /^[01xz]$/i.test(net);
}

export function makeId(prefix, value) {
  const safe = String(value).replace(/[^A-Za-z0-9_:.~-]+/g, "_");
  return `${prefix}:${safe}`;
}
