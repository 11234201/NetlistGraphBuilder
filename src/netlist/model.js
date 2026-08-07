export function createDesign() {
  return {
    modules: [],
    diagnostics: []
  };
}

const moduleIndexes = new WeakMap();

export function createModule(name, displayName = name, span = null) {
  return {
    name,
    displayName,
    span,
    portOrder: [],
    ports: [],
    nets: [],
    cells: [],
    assigns: [],
    diagnostics: []
  };
}

export function ensurePort(module, name, displayName = name, direction = "unknown", range = null) {
  const indexes = getModuleIndexes(module);
  let port = indexes.portByName.get(name);
  if (!port) {
    port = { name, displayName, direction, ...(range ? { range: { ...range } } : {}) };
    module.ports.push(port);
    indexes.portByName.set(name, port);
    indexes.portCount = module.ports.length;
  } else {
    port.displayName = port.displayName || displayName;
    if (direction !== "unknown") {
      port.direction = direction;
    }
    if (range) {
      port.range = { ...range };
    }
  }

  if (!indexes.portOrderNames.has(name)) {
    module.portOrder.push(name);
    indexes.portOrderNames.add(name);
    indexes.portOrderCount = module.portOrder.length;
  }

  ensureNet(module, name, displayName, "port", range);
  return port;
}

export function ensureNet(module, name, displayName = name, declaredKind = "implicit", range = null) {
  const indexes = getModuleIndexes(module);
  let net = indexes.netByName.get(name);
  if (!net) {
    net = { name, displayName, declaredKind, ...(range ? { range: { ...range } } : {}) };
    module.nets.push(net);
    indexes.netByName.set(name, net);
    indexes.netCount = module.nets.length;
    return net;
  }

  net.displayName = net.displayName || displayName;
  if (net.declaredKind === "implicit" || declaredKind === "port") {
    net.declaredKind = declaredKind;
  }
  if (range) {
    net.range = { ...range };
  }
  return net;
}

export function addCell(module, cell) {
  module.cells.push(cell);
  for (const pin of cell.pins) {
    if (pin.net) {
      ensureNet(module, pin.net, pin.netDisplayName || pin.net, "implicit");
    }
  }
}

export function addAssign(module, assign) {
  module.assigns.push(assign);
  ensureNet(module, assign.lhs, assign.lhsDisplayName || assign.lhs, "implicit");
  ensureNet(module, assign.rhs, assign.rhsDisplayName || assign.rhs, "implicit");
}

export function getNetDisplayName(module, name) {
  const net = getModuleIndexes(module).netByName.get(name);
  return net?.displayName || name;
}

export function getPortDisplayName(module, name) {
  const port = getModuleIndexes(module).portByName.get(name);
  return port?.displayName || getNetDisplayName(module, name);
}

function getModuleIndexes(module) {
  let indexes = moduleIndexes.get(module);
  if (
    !indexes ||
    indexes.ports !== module.ports ||
    indexes.nets !== module.nets ||
    indexes.portOrder !== module.portOrder ||
    indexes.portCount !== module.ports.length ||
    indexes.netCount !== module.nets.length ||
    indexes.portOrderCount !== module.portOrder.length
  ) {
    indexes = {
      ports: module.ports,
      nets: module.nets,
      portOrder: module.portOrder,
      portCount: module.ports.length,
      netCount: module.nets.length,
      portOrderCount: module.portOrder.length,
      portByName: indexFirstByName(module.ports),
      netByName: indexFirstByName(module.nets),
      portOrderNames: new Set(module.portOrder)
    };
    moduleIndexes.set(module, indexes);
  }
  return indexes;
}

function indexFirstByName(items) {
  const index = new Map();
  for (const item of items) {
    if (!index.has(item.name)) index.set(item.name, item);
  }
  return index;
}
