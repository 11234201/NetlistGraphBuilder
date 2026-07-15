export function createDesign() {
  return {
    modules: [],
    diagnostics: []
  };
}

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
  let port = module.ports.find((item) => item.name === name);
  if (!port) {
    port = { name, displayName, direction, ...(range ? { range: { ...range } } : {}) };
    module.ports.push(port);
  } else {
    port.displayName = port.displayName || displayName;
    if (direction !== "unknown") {
      port.direction = direction;
    }
    if (range) {
      port.range = { ...range };
    }
  }

  if (!module.portOrder.includes(name)) {
    module.portOrder.push(name);
  }

  ensureNet(module, name, displayName, "port", range);
  return port;
}

export function ensureNet(module, name, displayName = name, declaredKind = "implicit", range = null) {
  let net = module.nets.find((item) => item.name === name);
  if (!net) {
    net = { name, displayName, declaredKind, ...(range ? { range: { ...range } } : {}) };
    module.nets.push(net);
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
  const net = module.nets.find((item) => item.name === name);
  return net?.displayName || name;
}

export function getPortDisplayName(module, name) {
  const port = module.ports.find((item) => item.name === name);
  return port?.displayName || getNetDisplayName(module, name);
}
