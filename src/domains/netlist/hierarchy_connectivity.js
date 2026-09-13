import { inferCellKind, inferPinDirection } from "../../infer/defaultCellRules.js";

export const DEFAULT_HIERARCHY_CONE_LIMITS = Object.freeze({
  faninDepth: 3,
  fanoutDepth: 3,
  maximumVisibleNodes: 512,
  maximumFrontier: 1024
});

/**
 * Builds immutable, local connectivity templates. Templates intentionally keep
 * parser objects out of the query result; a query only exposes canonical names
 * and occurrence paths.
 */
export function buildModuleConnectivityTemplates(design) {
  const modules = [...(design?.modules || [])];
  const moduleByName = new Map(modules.map((module) => [module.name, module]));
  const templates = new Map();

  for (const module of modules.toSorted(compareNamed)) {
    templates.set(module.name, createModuleConnectivityTemplate(module, moduleByName));
  }
  return templates;
}

export function createModuleConnectivityTemplate(module, moduleByName = new Map()) {
  const ports = [...(module?.ports || [])].toSorted(compareNamed).map((port) => ({
    name: port.name,
    displayName: port.displayName || port.name,
    direction: normalizeDirection(port.direction),
    range: port.range ? { ...port.range } : null
  }));
  const portByName = new Map(ports.map((port) => [port.name, port]));
  const cells = [...(module?.cells || [])].toSorted(compareNamed).map((cell) => {
    const childModule = moduleByName.get(cell.type) || null;
    const pins = [...(cell.pins || [])].map((pin) => {
      const pinName = pin.pin;
      const childPort = childModule ? childModule.ports?.find((port) => port.name === pinName) : null;
      const direction = childPort
        ? normalizeDirection(childPort.direction)
        : normalizeDirection(inferPinDirection(pinName, cell.type)?.direction);
      return {
        name: pinName,
        displayName: pin.pinDisplayName || pinName,
        net: pin.net || "",
        netDisplayName: pin.netDisplayName || pin.net || "",
        direction,
        childPortName: childPort?.name || null
      };
    }).toSorted(compareNamed);
    return {
      instance: cell.instance,
      displayName: cell.instanceDisplayName || cell.instance,
      type: cell.type,
      childModuleName: childModule?.name || null,
      pins
    };
  });
  const cellByInstance = new Map(cells.map((cell) => [cell.instance, cell]));
  const connections = new Map();
  const ensureNet = (net) => {
    if (!net) return null;
    if (!connections.has(net)) connections.set(net, { drivers: [], loads: [] });
    return connections.get(net);
  };
  const addConnection = (net, direction, endpoint) => {
    const connection = ensureNet(net);
    if (!connection || direction === "unknown") return;
    const collection = direction === "output" ? connection.drivers : connection.loads;
    collection.push(endpoint);
    if (direction === "inout") {
      connection.drivers.push(endpoint);
      connection.loads.push(endpoint);
    }
  };

  for (const port of ports) {
    const endpoint = {
      kind: "port",
      localId: port.name,
      terminalId: port.name,
      direction: port.direction
    };
    // A module input drives its local net; a module output loads it. This is
    // the inverse of a cell pin's direction from the containing module's view.
    if (port.direction === "input") addConnection(port.name, "output", endpoint);
    else if (port.direction === "output") addConnection(port.name, "input", endpoint);
    else addConnection(port.name, "inout", endpoint);
  }

  for (const cell of cells) {
    for (const pin of cell.pins) {
      addConnection(pin.net, pin.direction, {
        kind: "cell",
        localId: cell.instance,
        terminalId: pin.name,
        pin: pin.name,
        direction: pin.direction,
        childModuleName: cell.childModuleName,
        childPortName: pin.childPortName
      });
    }
  }

  for (const assign of [...(module?.assigns || [])].toSorted((left, right) =>
    compareValues(`${left.lhs}:${left.rhs}`, `${right.lhs}:${right.rhs}`)
  )) {
    const localId = `${assign.lhs}:${assign.rhs}`;
    addConnection(assign.rhs, "input", {
      kind: "assign",
      localId,
      terminalId: "I",
      direction: "input",
      aliasNet: assign.lhs
    });
    addConnection(assign.lhs, "output", {
      kind: "assign",
      localId,
      terminalId: "Z",
      direction: "output",
      aliasNet: assign.rhs
    });
  }

  const normalizedConnections = new Map();
  for (const net of [...connections.keys()].toSorted(compareValues)) {
    const connection = connections.get(net);
    normalizedConnections.set(net, Object.freeze({
      drivers: Object.freeze(uniqueEndpoints(connection.drivers)),
      loads: Object.freeze(uniqueEndpoints(connection.loads))
    }));
  }

  return Object.freeze({
    moduleName: module.name,
    moduleDisplayName: module.displayName || module.name,
    ports: Object.freeze(ports.map((port) => Object.freeze(port))),
    portByName,
    cells: Object.freeze(cells.map((cell) => Object.freeze({
      ...cell,
      pins: Object.freeze(cell.pins.map((pin) => Object.freeze(pin)))
    }))),
    cellByInstance,
    nets: Object.freeze([...normalizedConnections.keys()]),
    connections: normalizedConnections
  });
}

/**
 * Traverses a cell/net/port without flattening the design. Crossing a module
 * port and its hinst terminal costs zero logical depth; visiting a real logic
 * cell costs one. The result is suitable for a later graph projection and is
 * deliberately independent from parser array order.
 */
export function analyzeHierarchicalCone(design, root, options = {}) {
  const templates = options.templates || buildModuleConnectivityTemplates(design);
  const limits = normalizeLimits(options);
  const rootModuleName = root?.rootModuleName || root?.moduleName;
  const rootPath = normalizeOccurrencePath(root?.occurrencePath);
  const context = resolveOccurrenceContext(templates, rootModuleName, rootPath);
  const result = createResult(root, rootModuleName, rootPath, limits);
  if (!context) {
    result.diagnostics.push(diagnostic("missing-occurrence", `Unknown occurrence ${rootModuleName || "-"}`));
    return finalizeResult(result);
  }
  if (root?.moduleName && root.moduleName !== context.moduleName) {
    result.diagnostics.push(diagnostic("occurrence-module-mismatch", `${root.moduleName} at ${rootPath.join("/") || "$"}`));
    return finalizeResult(result);
  }

  const directions = normalizeDirections(options.direction);
  const queues = [];
  seedRoot(result, queues, context, root, directions, limits, templates);
  const visited = new Map();

  while (queues.length > 0) {
    queues.sort(compareStates);
    const state = queues.shift();
    const visitKey = `${state.occurrenceKey}|${state.net}|${state.direction}`;
    const previousDepth = visited.get(visitKey);
    if (previousDepth !== undefined && previousDepth <= state.depth) continue;
    visited.set(visitKey, state.depth);
    if (state.depth > state.depthLimit) {
      addBoundary(result, state, "depth-limit");
      continue;
    }
    visitNet(result, queues, state, templates, limits);
  }

  return finalizeResult(result);
}

/** Project a bounded hierarchical query while retaining occurrence identity. */
export function projectHierarchicalCone(result, options = {}) {
  const documentId = options.documentId || "hierarchy:projection";
  const nodes = (result?.nodes || []).map((node) => ({
    id: node.id,
    kind: node.kind,
    label: node.label || node.localId,
    moduleName: node.moduleName,
    localId: node.localId,
    direction: node.direction || null,
    type: node.type || null,
    occurrencePath: [...(node.occurrencePath || [])],
    ref: {
      documentId,
      unitId: node.moduleName,
      kind: node.kind === "cell" ? "cell" : node.kind,
      localId: node.localId,
      ...(node.occurrencePath?.length ? { occurrencePath: [...node.occurrencePath] } : {})
    }
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (result?.links || []).filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target)).map((link) => ({
    id: `${link.source}->${link.target}`,
    source: link.source,
    target: link.target,
    relation: link.relation,
    depth: link.depth
  }));
  return {
    view: { mode: "hierarchical-cone", root: result?.root || null },
    nodes,
    edges,
    diagnostics: [...(result?.diagnostics || [])],
    truncated: Boolean(result?.truncated),
    hiddenNodeCount: Number(result?.hiddenNodeCount) || 0
  };
}

/**
 * Adapt a hierarchical projection to the renderer-neutral graph contract used
 * by the regular measure/layout/Scene pipeline. Net nodes become explicit hubs;
 * this keeps occurrence identity visible without flattening the source design.
 */
export function projectHierarchicalRenderGraph(result, options = {}) {
  const projection = projectHierarchicalCone(result, options);
  const renderId = (node) => {
    const path = node.occurrencePath?.join("/") || "top";
    if (node.kind === "cell") return path === "top" ? `cell:${node.localId}` : `cell:${path}/${node.localId}`;
    if (node.kind === "net") return `hub:${path}/${node.localId}`;
    return `${node.kind}:${path}/${node.localId}`;
  };
  const idMap = new Map(projection.nodes.map((node) => [node.id, renderId(node)]));
  const nodes = projection.nodes.map((node) => {
    const id = idMap.get(node.id);
    if (node.kind === "net") {
      return {
        ...node,
        id,
        kind: "hub",
        label: node.label,
        title: "NET",
        subtitle: node.moduleName,
        ref: { ...node.ref, kind: "net" }
      };
    }
    if (node.kind === "port") {
      const kind = node.direction === "output" ? "output" : "input";
      return { ...node, id, kind, title: kind.toUpperCase(), ref: { ...node.ref, kind } };
    }
    if (node.kind === "cell") {
      const inferred = inferCellKind(node.type || node.label);
      return {
        ...node,
        id,
        gateKind: inferred.kind,
        inferenceSource: inferred.source,
        title: inferred.kind.toUpperCase(),
        subtitle: node.type || node.moduleName,
        pinDirections: { IN: { direction: "input", role: "data" }, OUT: { direction: "output", role: "data" } },
        portDescriptors: [
          { pin: "IN", rawPin: "IN", direction: "input", role: "data", side: "left" },
          { pin: "OUT", rawPin: "OUT", direction: "output", role: "data", side: "right" }
        ]
      };
    }
    return { ...node, id };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = projection.edges.map((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const net = source?.kind === "hub" ? source.label : target?.kind === "hub" ? target.label : edge.id;
    return {
      id: edge.id,
      source: idMap.get(edge.source),
      target: idMap.get(edge.target),
      net,
      sourcePin: "OUT",
      targetPin: "IN",
      sourceRole: "source",
      targetRole: "target",
      relation: edge.relation,
      depth: edge.depth
    };
  });
  return {
    ...projection,
    nodes,
    edges,
    stats: {
      ports: nodes.filter((node) => node.kind === "input" || node.kind === "output").length,
      nets: nodes.filter((node) => node.kind === "hub").length,
      cells: nodes.filter((node) => node.kind === "cell").length,
      assigns: nodes.filter((node) => node.kind === "assign").length
    }
  };
}

function seedRoot(result, queues, context, root, directions, limits, templates) {
  const template = context.template;
  const rootKind = root?.kind || "net";
  const rootId = root?.localId || root?.name;
  if (rootKind === "cell") {
    const cell = template.cellByInstance.get(rootId);
    if (!cell) {
      result.diagnostics.push(diagnostic("missing-root", `Cell ${rootId || "-"} is not present`));
      return;
    }
    addNode(result, context, "cell", cell.instance, null, { label: cell.displayName, type: cell.type });
    for (const direction of directions) {
      const wanted = direction === "fanin" ? ["input", "inout"] : ["output", "inout"];
      for (const pin of cell.pins.filter((item) => wanted.includes(item.direction))) {
        enqueue(queues, result, context, pin.net, direction, 0, direction === "fanin" ? limits.faninDepth : limits.fanoutDepth, {
          from: nodeKey(context, "cell", cell.instance),
          relation: direction,
          terminalId: pin.name
        });
      }
    }
    // A hierarchical instance is also a boundary seed: follow an input port
    // inward for fanout and an output port inward for fanin so the local cone
    // can include real logic inside the child definition.
    if (cell.childModuleName) {
      const childTemplate = templates.get(cell.childModuleName);
      const childContext = resolveOccurrenceContext(templates, result.rootModuleName, [
        ...context.occurrencePath,
        cell.instance
      ]);
      if (childTemplate && childContext) {
        for (const pin of cell.pins) {
          const childPort = childTemplate.portByName.get(pin.childPortName || pin.name);
          if (!childPort) continue;
          const inwardDirection = childPort.direction === "input"
            ? "fanout"
            : childPort.direction === "output" ? "fanin" : null;
          if (!inwardDirection || !directions.includes(inwardDirection)) continue;
          enqueue(queues, result, childContext, childPort.name, inwardDirection, 0,
            inwardDirection === "fanin" ? limits.faninDepth : limits.fanoutDepth, {
              from: nodeKey(context, "cell", cell.instance),
              relation: "module-boundary",
              moduleAncestry: [...context.moduleAncestry, cell.childModuleName]
            });
        }
      }
    }
    return;
  }

  const netName = rootKind === "port"
    ? template.portByName.get(rootId)?.name || rootId
    : rootId;
  if (!netName || !template.connections.has(netName)) {
    result.diagnostics.push(diagnostic("missing-root", `Net ${netName || "-"} is not present`));
    return;
  }
  addNode(result, context, rootKind === "port" ? "port" : "net", netName, rootKind === "port" ? netName : null);
  for (const direction of directions) {
    enqueue(queues, result, context, netName, direction, 0, direction === "fanin" ? limits.faninDepth : limits.fanoutDepth);
  }
}

function visitNet(result, queues, state, templates, limits) {
  const context = resolveOccurrenceContext(templates, state.rootModuleName, state.occurrencePath);
  if (!context) {
    addBoundary(result, state, "missing-occurrence");
    return;
  }
  const connection = context.template.connections.get(state.net);
  addNode(result, context, "net", state.net, null);
  if (!connection) {
    addBoundary(result, state, "missing-net");
    return;
  }
  const boundaryPorts = context.template.ports
    .filter((port) => port.name === state.net)
    .filter((port) => state.direction === "fanin"
      ? ["output", "inout"].includes(port.direction)
      : ["input", "inout"].includes(port.direction))
    .map((port) => ({
      kind: "port",
      localId: port.name,
      terminalId: port.name,
      direction: port.direction
    }));
  const localEndpoints = state.direction === "fanin" ? connection.drivers : connection.loads;
  const endpoints = uniqueEndpoints([...localEndpoints, ...boundaryPorts]);
  for (const endpoint of endpoints) {
    const endpointNode = addNode(result, context, endpoint.kind, endpoint.localId, endpoint.terminalId, endpoint);
    if (!endpointNode) continue;
    addLink(result, state, endpointNode, state.direction === "fanin" ? "driver" : "load");
    if (endpoint.kind === "cell") {
      followCellEndpoint(result, queues, state, context, endpoint, templates, limits);
    } else if (endpoint.kind === "assign") {
      enqueue(queues, result, context, endpoint.aliasNet, state.direction, state.depth, state.depthLimit, {
        from: endpointNode.id,
        relation: "alias"
      });
    } else if (endpoint.kind === "port") {
      followPortEndpoint(result, queues, state, context, endpoint, templates, limits);
    }
  }
}

function followCellEndpoint(result, queues, state, context, endpoint, templates, limits) {
  const cell = context.template.cellByInstance.get(endpoint.localId);
  if (!cell) return;
  if (cell.childModuleName) {
    const childTemplate = templates.get(cell.childModuleName);
    const childPortName = endpoint.childPortName || endpoint.terminalId;
    const childPort = childTemplate?.portByName.get(childPortName);
    if (!childTemplate || !childPort) {
      addBoundary(result, state, "missing-child-port", `${cell.instance}.${childPortName}`);
      return;
    }
    const expectedDirection = state.direction === "fanin" ? ["output", "inout"] : ["input", "inout"];
    if (!expectedDirection.includes(childPort.direction)) {
      if (childPort.direction === "unknown") addBoundary(result, state, "unknown-boundary-direction", `${cell.instance}.${childPortName}`);
      return;
    }
    const nextPath = [...state.occurrencePath, cell.instance];
    if (nextPath.length > limits.maximumDepth || state.moduleAncestry.includes(cell.childModuleName)) {
      addBoundary(result, state, "recursive-cycle", cell.childModuleName);
      return;
    }
    const childContext = resolveOccurrenceContext(templates, state.rootModuleName, nextPath);
    if (!childContext) {
      addBoundary(result, state, "missing-occurrence", nextPath.join("/"));
      return;
    }
    enqueue(queues, result, childContext, childPort.name, state.direction, state.depth, state.depthLimit, {
      from: nodeKey(context, endpoint.kind, endpoint.localId, endpoint.terminalId),
      relation: "module-boundary",
      moduleAncestry: [...state.moduleAncestry, cell.childModuleName]
    });
    return;
  }

  if (cell.type && !templates.has(cell.type)) {
    addBoundary(result, state, "blackbox", cell.type);
  }
  const childDirection = state.direction === "fanin" ? ["input", "inout"] : ["output", "inout"];
  for (const pin of cell.pins.filter((item) => childDirection.includes(item.direction))) {
    enqueue(queues, result, context, pin.net, state.direction, state.depth + 1, state.depthLimit, {
      from: nodeKey(context, endpoint.kind, endpoint.localId, endpoint.terminalId),
      relation: "logic-cell",
      terminalId: pin.name
    });
  }
}

function followPortEndpoint(result, queues, state, context, endpoint, templates, limits) {
  if (context.occurrencePath.length === 0) {
    addBoundary(result, state, "root-port", endpoint.localId);
    return;
  }
  const parentPath = context.occurrencePath.slice(0, -1);
  const parentContext = resolveOccurrenceContext(templates, state.rootModuleName, parentPath);
  const parentInstance = parentContext?.template.cellByInstance.get(context.occurrencePath.at(-1));
  const pin = parentInstance?.pins.find((item) => item.name === endpoint.localId);
  if (!parentContext || !parentInstance || !pin || !pin.net) {
    addBoundary(result, state, "missing-parent-port", endpoint.localId);
    return;
  }
  const expectedDirection = state.direction === "fanin" ? ["input", "inout"] : ["output", "inout"];
  if (!expectedDirection.includes(endpoint.direction)) {
    if (endpoint.direction === "unknown") addBoundary(result, state, "unknown-boundary-direction", endpoint.localId);
    return;
  }
  const parentEndpoint = {
    kind: "cell",
    localId: parentInstance.instance,
    terminalId: pin.name,
    pin: pin.name,
    direction: pin.direction,
    childModuleName: parentInstance.childModuleName,
    childPortName: pin.childPortName
  };
  addNode(result, parentContext, "cell", parentEndpoint.localId, parentEndpoint.terminalId, parentEndpoint);
  enqueue(queues, result, parentContext, pin.net, state.direction, state.depth, state.depthLimit, {
    from: nodeKey(context, endpoint.kind, endpoint.localId, endpoint.terminalId),
    relation: "module-boundary",
    moduleAncestry: state.moduleAncestry.slice(0, -1)
  });
}

function enqueue(queues, result, context, net, direction, depth, depthLimit, link = {}) {
  if (!net) return;
  if (queues.length >= result.limits.maximumFrontier) {
    result.truncated = true;
    result.hiddenNodeCount += 1;
    result.diagnostics.push(diagnostic("frontier-limit", `Frontier limit reached at ${net}`));
    return;
  }
  queues.push({
    rootModuleName: result.rootModuleName,
    occurrencePath: [...context.occurrencePath],
    occurrenceKey: context.occurrenceKey,
    moduleName: context.moduleName,
    moduleAncestry: context.moduleAncestry,
    net,
    direction,
    depth,
    depthLimit,
    ...link
  });
}

function addNode(result, context, kind, localId, terminalId = null, extra = {}) {
  const id = nodeKey(context, kind, localId, terminalId);
  if (result.nodeById.has(id)) return result.nodeById.get(id);
  if (result.nodes.length >= result.limits.maximumVisibleNodes) {
    result.truncated = true;
    result.hiddenNodeCount += 1;
    return null;
  }
  const node = Object.freeze({
    id,
    kind,
    moduleName: context.moduleName,
    occurrencePath: Object.freeze([...context.occurrencePath]),
    localId,
    ...(terminalId && kind !== "cell" ? { terminalId } : {}),
    ...(extra.direction ? { direction: extra.direction } : {}),
    ...(extra.pin ? { pin: extra.pin } : {}),
    ...("label" in extra ? { label: extra.label } : {}),
    ...(extra.type ? { type: extra.type } : {})
  });
  result.nodeById.set(id, node);
  result.nodes.push(node);
  return node;
}

function addLink(result, state, endpointNode, relation) {
  const netId = nodeKeyFromState(state);
  const link = relation === "driver"
    ? { source: endpointNode.id, target: netId, relation, depth: state.depth }
    : { source: netId, target: endpointNode.id, relation, depth: state.depth };
  const key = `${link.source}|${link.target}|${relation}`;
  if (result.linkKeys.has(key)) return;
  result.linkKeys.add(key);
  result.links.push(Object.freeze(link));
}

function addBoundary(result, state, reason, detail = null) {
  const key = `${state.occurrenceKey}|${state.net}|${state.direction}|${reason}|${detail || ""}`;
  if (result.boundaryKeys.has(key)) return;
  result.boundaryKeys.add(key);
  result.diagnostics.push(diagnostic(reason, detail || `${state.moduleName}.${state.net}`));
}

function resolveOccurrenceContext(templates, rootModuleName, occurrencePath) {
  const rootTemplate = templates.get(rootModuleName);
  if (!rootTemplate) return null;
  let template = rootTemplate;
  const moduleAncestry = [rootModuleName];
  for (const segment of occurrencePath) {
    const cell = template.cellByInstance.get(segment);
    if (!cell?.childModuleName) return null;
    template = templates.get(cell.childModuleName);
    if (!template) return null;
    moduleAncestry.push(template.moduleName);
  }
  return {
    template,
    moduleName: template.moduleName,
    occurrencePath: [...occurrencePath],
    occurrenceKey: `${rootModuleName}:${occurrencePath.join("/") || "$"}`,
    moduleAncestry
  };
}

function createResult(root, rootModuleName, rootPath, limits) {
  return {
    root: root ? { ...root, occurrencePath: [...rootPath] } : null,
    rootModuleName,
    rootOccurrencePath: [...rootPath],
    limits,
    nodes: [],
    nodeById: new Map(),
    links: [],
    linkKeys: new Set(),
    diagnostics: [],
    boundaryKeys: new Set(),
    hiddenNodeCount: 0,
    truncated: false
  };
}

function finalizeResult(result) {
  return Object.freeze({
    root: result.root ? Object.freeze(result.root) : null,
    rootModuleName: result.rootModuleName,
    rootOccurrencePath: Object.freeze([...result.rootOccurrencePath]),
    nodes: Object.freeze(result.nodes.toSorted(compareNode)),
    links: Object.freeze(result.links.toSorted(compareLink)),
    diagnostics: Object.freeze(result.diagnostics.toSorted(compareDiagnostic)),
    hiddenNodeCount: result.hiddenNodeCount,
    truncated: result.truncated
  });
}

function normalizeLimits(options) {
  return {
    faninDepth: normalizeLimit(options.faninDepth, DEFAULT_HIERARCHY_CONE_LIMITS.faninDepth, 0),
    fanoutDepth: normalizeLimit(options.fanoutDepth, DEFAULT_HIERARCHY_CONE_LIMITS.fanoutDepth, 0),
    maximumVisibleNodes: normalizeLimit(options.maximumVisibleNodes ?? options.maxNodes, DEFAULT_HIERARCHY_CONE_LIMITS.maximumVisibleNodes, 1),
    maximumFrontier: normalizeLimit(options.maximumFrontier, DEFAULT_HIERARCHY_CONE_LIMITS.maximumFrontier, 1),
    maximumDepth: normalizeLimit(options.maximumDepth, 64, 0)
  };
}

function normalizeDirections(value) {
  if (value === "fanin" || value === "fanout") return [value];
  return ["fanin", "fanout"];
}

function normalizeOccurrencePath(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [];
  return value.filter((segment) => typeof segment === "string" && segment.length > 0);
}

function normalizeDirection(value) {
  return value === "input" || value === "output" || value === "inout" ? value : "unknown";
}

function nodeKey(context, kind, localId, terminalId = null) {
  return [context.occurrenceKey, kind, localId, kind === "cell" ? "" : terminalId || ""].join("|");
}

function nodeKeyFromState(state) {
  return [state.occurrenceKey, "net", state.net, ""].join("|");
}

function uniqueEndpoints(endpoints) {
  const seen = new Set();
  return endpoints.filter((endpoint) => {
    const key = `${endpoint.kind}|${endpoint.localId}|${endpoint.terminalId || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).toSorted(compareEndpoint).map((endpoint) => Object.freeze({ ...endpoint }));
}

function compareNamed(left, right) {
  return compareValues(left?.name || left?.instance, right?.name || right?.instance);
}

function compareEndpoint(left, right) {
  return compareValues(`${left.kind}:${left.localId}:${left.terminalId || ""}`, `${right.kind}:${right.localId}:${right.terminalId || ""}`);
}

function compareNode(left, right) {
  return compareValues(left.id, right.id);
}

function compareLink(left, right) {
  return compareValues(`${left.source}|${left.target}|${left.relation}`, `${right.source}|${right.target}|${right.relation}`);
}

function compareDiagnostic(left, right) {
  return compareValues(`${left.code}:${left.message}`, `${right.code}:${right.message}`);
}

function compareStates(left, right) {
  return compareValues(`${left.depth}:${left.occurrenceKey}:${left.net}:${left.direction}`, `${right.depth}:${right.occurrenceKey}:${right.net}:${right.direction}`);
}

function compareValues(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeLimit(value, fallback, minimum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.floor(number)) : fallback;
}

function diagnostic(code, message) {
  return Object.freeze({ code, severity: "warning", message });
}
