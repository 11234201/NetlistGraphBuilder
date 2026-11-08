import { inferCellKind, inferPinDirection } from "../infer/defaultCellRules.js";
import { getNetDisplayName, getPortDisplayName, getPinNetReferences } from "./model.js";
import { ensureFallbackCellPinDirections } from "../infer/defaultCellRules.js";
import { isInvertingOutputGate } from "../infer/defaultCellRules.js";
import { resolveCellConfigDefinition, toInternalGateKind } from "../infer/cellConfig.js";
import { getPinConnectionEndpoints } from "./pin_connections.js";

export function buildSchematicGraph(module, options = {}) {
  const overrides = normalizeGraphOverrides(options.overrides);
  const moduleByName = normalizeModuleLibrary(options.moduleLibrary || options.design?.modules);
  const cellConfig = options.cellConfig || null;
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
  const referencedNets = collectReferencedNets(module);
  const expandedPortsByName = new Map(module.ports.map((port) => [
    port.name,
    expandPortEndpoints(port, referencedNets)
  ]));
  const nodeIdentityGroups = buildNodeIdentityGroups(module, expandedPortsByName, referencedNets);
  const makeNodeId = (prefix, value) => makeCollisionAwareId(prefix, value, nodeIdentityGroups);

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
  const addDriver = (net, driver) => {
    if (!drivers.has(net)) drivers.set(net, []);
    drivers.get(net).push(driver);
  };

  for (const [order, declaredPort] of module.ports.entries()) {
    for (const port of expandedPortsByName.get(declaredPort.name) || []) {
      if (port.direction === "input" || port.direction === "inout") {
        const node = addNode({
          id: makeNodeId("input", port.name),
          kind: "input",
          label: port.displayName,
          title: "INPUT",
          order,
          ref: port
        });
        applyNodePropertyOverrides(node, overrides);
        addDriver(port.name, {
          nodeId: node.id,
          pin: port.displayName,
          source: "port"
        });
      }

      if (port.direction === "output" || port.direction === "inout") {
        const node = addNode({
          id: makeNodeId("output", port.name),
          kind: "output",
          label: port.displayName,
          title: "OUTPUT",
          order,
          ref: port
        });
        applyNodePropertyOverrides(node, overrides);
        addLoad(port.name, {
          nodeId: node.id,
          pin: port.displayName,
          source: "port"
        });
      }
    }
  }

  for (const cell of module.cells) {
    const referencedModule = moduleByName.get(cell.type);
    const configuredDefinition = referencedModule ? null : resolveCellConfigDefinition(cellConfig, cell.type);
    const cellKind = referencedModule
      ? { kind: "module", source: "module-definition" }
      : configuredDefinition
        ? { kind: toInternalGateKind(configuredDefinition.gateKind), source: "user-config" }
        : inferCellKind(cell.type);
    const pinDirections = cellKind.source === "unknown"
      ? ensureFallbackCellPinDirections(getCellPinDirections(
        cell,
        overrides,
        referencedModule,
        configuredDefinition
      ))
      : getCellPinDirections(cell, overrides, referencedModule, configuredDefinition);
    const node = addNode({
      id: makeNodeId("cell", cell.instance),
      kind: "cell",
      gateKind: cellKind.kind,
      inferenceSource: cellKind.source,
      label: cell.instanceDisplayName || cell.instance,
      title: getCellTitle(cell, cellKind),
      subtitle: cell.typeDisplayName || cell.type,
      pinDirections,
      portDescriptors: cell.pins.flatMap((pin) => {
        const pinName = pin.pinDisplayName || pin.pin;
        const rule = pinDirections[pinName] || pinDirections[pin.pin] || inferPinDirection(pin.pin, cell.type);
        const endpoints = getPinConnectionEndpoints(pin);
        return (endpoints.length ? endpoints : [{ pin: pinName }]).map((endpoint) => ({
          pin: endpoint.pin,
          rawPin: pin.pin,
          direction: rule.direction,
          role: rule.role,
          side: rule.side || (rule.direction === "output" ? "right" : "left")
        }));
      }),
      outputBubble: isInvertingOutputGate(cellKind.kind),
      referencedModuleName: referencedModule?.name || null,
      navigationTarget: referencedModule ? { kind: "unit", id: referencedModule.name } : null,
      ref: cell
    });
    applyNodePropertyOverrides(node, overrides);

    for (const pin of cell.pins) {
      for (const reference of getPinConnectionEndpoints(pin)) {
        const net = reference.name;
        const pinDirection = pinDirections[pin.pinDisplayName || pin.pin] ||
          inferPinDirection(pin.pin, cell.type);
        if (pinDirection.direction === "output" || pinDirection.direction === "inout") {
          addDriver(net, {
            nodeId: node.id,
            pin: reference.pin,
            source: "cell"
          });
        }
        if (pinDirection.direction !== "output") {
          addLoad(net, {
            nodeId: node.id,
            pin: reference.pin,
            source: "cell"
          });
        }
      }
    }
  }

  for (const assign of module.assigns) {
    const node = addNode({
      id: makeNodeId("assign", `${assign.lhs}:${assign.rhs}`),
      kind: "assign",
      gateKind: "alias",
      inferenceSource: "assign",
      label: assign.lhsDisplayName || assign.lhs,
      title: "ALIAS",
      subtitle: "assign alias",
      ref: assign
    });
    applyNodePropertyOverrides(node, overrides);

    addLoad(assign.rhs, {
      nodeId: node.id,
      pin: "I",
      source: "assign"
    });
    addDriver(assign.lhs, {
      nodeId: node.id,
      pin: "Z",
      source: "assign"
    });
  }

  for (const [net, netLoads] of loads.entries()) {
    const netDrivers = drivers.get(net) || [createImplicitDriver(module, graph, addNode, net, overrides, makeNodeId)];
    if (netDrivers.length > 1) {
      graph.diagnostics.push({
        severity: "warning",
        message: `Net ${getNetDisplayName(module, net)} has multiple drivers`,
        driverCount: netDrivers.length
      });
    }
    for (const driver of netDrivers) {
      for (const load of netLoads) {
        if (driver.nodeId === load.nodeId && driver.pin === load.pin) continue;
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
  }

  annotateGraphMetadata(graph, module);

  return graph;
}

function collectReferencedNets(module) {
  return new Set([
    ...module.cells.flatMap((cell) => cell.pins.flatMap((pin) => getPinNetReferences(pin).map((ref) => ref.name))),
    ...module.assigns.flatMap((assign) => [assign.lhs, assign.rhs])
  ].filter(Boolean));
}

function expandPortEndpoints(port, referencedNets) {
  const range = port.range;
  if (!range || !Number.isInteger(range.msb) || !Number.isInteger(range.lsb)) {
    return [port];
  }

  const step = range.msb <= range.lsb ? 1 : -1;
  const bits = [];
  for (let index = range.msb; ; index += step) {
    bits.push({
      ...port,
      name: `${port.name}[${index}]`,
      displayName: `${port.displayName}[${index}]`,
      parentName: port.name,
      bitIndex: index
    });
    if (index === range.lsb) break;
  }

  const referencedBits = bits.filter((bit) => referencedNets.has(bit.name));
  if (referencedNets.has(port.name) && referencedBits.length === 0) {
    return [port];
  }
  if (referencedNets.has(port.name)) {
    bits.push(port);
  }
  return bits;
}

function annotateGraphMetadata(graph, module) {
  const fanoutByNodeId = new Map();
  for (const edge of graph.edges) {
    fanoutByNodeId.set(edge.source, (fanoutByNodeId.get(edge.source) || 0) + 1);
  }
  for (const node of graph.nodes) {
    if (node.kind !== "cell") {
      continue;
    }
    const outputNets = uniqueValues((node.ref?.pins || [])
      .filter((pin) => {
        const pinName = pin.pinDisplayName || pin.pin;
        const direction = node.pinDirections?.[pinName]?.direction;
        return direction === "output" || direction === "inout";
      })
      .flatMap((pin) => getPinNetReferences(pin).map((ref) => ref.displayName || getNetDisplayName(module, ref.name))));
    const fanout = fanoutByNodeId.get(node.id) || 0;
    node.metadata = {
      cellType: node.subtitle || "-",
      instance: node.label,
      outputNets,
      fanout
    };
    node.metadataText = `${node.metadata.cellType} | ${outputNets.join(", ") || "-"} | fo ${fanout}`;
  }
}

function getCellPinDirections(cell, overrides, referencedModule = null, configuredDefinition = null) {
  const directions = {};
  const cellOverrides = overrides.cellPinDirections[cell.instance] || {};
  const modulePorts = new Map((referencedModule?.ports || []).map((port) => [port.name, port]));
  for (const pin of cell.pins) {
    const displayName = pin.pinDisplayName || pin.pin;
    const overrideDirection = normalizePinDirection(cellOverrides[pin.pin] ?? cellOverrides[displayName]);
    const modulePort = modulePorts.get(pin.pin);
    const configuredDirection = configuredDefinition?.pins?.[pin.pin] ?? configuredDefinition?.pins?.[displayName];
    if (modulePort && isKnownPortDirection(modulePort.direction)) {
      directions[displayName] = {
        direction: modulePort.direction,
        source: "module-definition",
        moduleName: referencedModule.name
      };
    } else if (overrideDirection) {
      directions[displayName] = {
        direction: overrideDirection,
        source: "override"
      };
    } else if (configuredDirection) {
      directions[displayName] = {
        direction: configuredDirection,
        source: "user-config"
      };
    } else {
      directions[displayName] = inferPinDirection(pin.pin, cell.type);
    }
  }
  return directions;
}

function normalizeModuleLibrary(value) {
  if (value instanceof Map) return value;
  const modules = Array.isArray(value) ? value : value?.modules || [];
  return new Map(modules.map((item) => [item.name, item]));
}

function isKnownPortDirection(value) {
  return value === "input" || value === "output" || value === "inout";
}

function getCellTitle(cell, cellKind) {
  if (cellKind.kind === "module") {
    return "MODULE";
  }
  if (cellKind.kind !== "blackbox") {
    return cellKind.kind.toUpperCase();
  }

  const type = String(cell.typeDisplayName || cell.type || "BLACKBOX").replace(/^\\/, "");
  const driveStrengthIndex = type.search(/X\d/i);
  const functionalPrefix = driveStrengthIndex > 0
    ? type.slice(0, driveStrengthIndex)
    : type.match(/^[A-Za-z]+\d*/)?.[0] || type;
  return functionalPrefix.slice(0, 18).toUpperCase();
}

function applyNodePropertyOverrides(node, overrides) {
  const propertyOverride = overrides.nodeProperties[node.id];
  if (!propertyOverride) {
    return;
  }

  for (const key of ["label", "title", "subtitle", "gateKind", "inferenceSource"]) {
    if (propertyOverride[key] !== undefined && propertyOverride[key] !== "") {
      node[key] = String(propertyOverride[key]);
    }
  }
}

function normalizeGraphOverrides(overrides) {
  return {
    nodeProperties: overrides?.nodeProperties || {},
    cellPinDirections: overrides?.cellPinDirections || {}
  };
}

function normalizePinDirection(value) {
  if (value === "input" || value === "output") {
    return value;
  }
  return null;
}

function createImplicitDriver(module, graph, addNode, net, overrides, makeNodeId = makeId) {
  const constant = isConstantNet(net);
  const kind = constant ? "constant" : "implicit";
  const node = addNode({
    id: makeNodeId(kind, net),
    kind,
    label: getNetDisplayName(module, net),
    title: constant ? "CONST" : "IMPLICIT",
    order: -1,
    ref: { name: net, displayName: getNetDisplayName(module, net) }
  });
  applyNodePropertyOverrides(node, overrides);

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
  return /^(?:\d+)?'[sS]?[bBdDhHoO][0-9a-fA-FxXzZ?_]+$/.test(net) ||
    /^'[01xXzZ]$/.test(net) || /^-?\d+$/.test(net);
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

export function makeId(prefix, value) {
  const safe = String(value).replace(/[^A-Za-z0-9_:.~-]+/g, "_");
  return `${prefix}:${safe}`;
}

function buildNodeIdentityGroups(module, expandedPortsByName, referencedNets) {
  const valuesByPrefix = new Map([
    ["input", module.ports.flatMap((port) => (expandedPortsByName.get(port.name) || [])
      .filter((item) => item.direction === "input" || item.direction === "inout").map((item) => item.name))],
    ["output", module.ports.flatMap((port) => (expandedPortsByName.get(port.name) || [])
      .filter((item) => item.direction === "output" || item.direction === "inout").map((item) => item.name))],
    ["cell", module.cells.map((cell) => cell.instance)],
    ["assign", module.assigns.map((assign) => `${assign.lhs}:${assign.rhs}`)],
    ["implicit", [...module.nets.map((net) => net.name), ...referencedNets]],
    ["constant", [...referencedNets]]
  ]);
  const result = new Map();
  for (const [prefix, values] of valuesByPrefix) {
    const byLegacyId = new Map();
    for (const value of values) {
      const id = makeId(prefix, value);
      if (!byLegacyId.has(id)) byLegacyId.set(id, new Set());
      byLegacyId.get(id).add(String(value));
    }
    result.set(prefix, byLegacyId);
  }
  return result;
}

function makeCollisionAwareId(prefix, value, groups) {
  const legacyId = makeId(prefix, value);
  const identities = groups.get(prefix)?.get(legacyId);
  if (!identities || identities.size < 2) return legacyId;
  const raw = String(value), legacyValue = legacyId.slice(prefix.length + 1);
  return raw === legacyValue ? legacyId : `${legacyId}~${encodeURIComponent(raw)}`;
}
