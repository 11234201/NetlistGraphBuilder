// Focused commits an induced subgraph. Recover its logical connections from
// the source adjacency so routing exclusions and fanout hubs stay geometric.
const sourceIndexes = new WeakMap();

export function preserveAliasDriverAmbiguity(normalized, raw) {
  if (!normalized.aliases?.length || !raw.diagnostics?.some((entry) => entry.driverCount > 1)) return normalized;
  const aliases = new Set(normalized.aliases.map((alias) => alias.nodeId));
  const first = new Map(), ambiguous = new Set();
  for (const edge of raw.edges) {
    if (!aliases.has(edge.target)) continue;
    const driver = JSON.stringify([edge.source, edge.sourcePin]);
    if (first.has(edge.target) && first.get(edge.target) !== driver) ambiguous.add(edge.net);
    first.set(edge.target, driver);
  }
  // Workspace artifacts snapshot the graph. Persist only the names needed to
  // qualify folded wires, independent of any object or array identity.
  return ambiguous.size ? { ...normalized, ambiguousAliasInputs: [...ambiguous].sort() } : normalized;
}

const fixedOutput = (node, pin) => node?.kind === "constant" || node?.libraryInfo?.logicStatus === "constant" ||
  /^[01]$/.test(node?.libraryInfo?.functions?.[pin]?.trim?.() || "");

function sourceIndex(graph) {
  let index = sourceIndexes.get(graph);
  if (index) return index;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map(), drivers = new Map(), ambiguous = new Set(graph.ambiguousAliasInputs);
  for (const edge of graph.edges) {
    const endpoint = JSON.stringify([edge.source, edge.sourcePin]);
    if (drivers.has(edge.net) && drivers.get(edge.net) !== endpoint) ambiguous.add(edge.net);
    drivers.set(edge.net, endpoint);
  }
  const aliasInput = new Map((graph.aliases || []).map((alias) => [alias.nodeId, alias.rhs]));
  const ambiguousAliases = new Set(), ambiguousQueue = [];
  const uncertain = (edge) => ambiguousAliases.has(edge.source) || ambiguous.has(edge.net) ||
    (ambiguous.size > 0 && edge.collapsedAliasNodeIds?.some((id) => ambiguous.has(aliasInput.get(id))));
  const aliasDrivers = new Map(), pending = [];
  const ports = new Map();
  function canUse(node, pin, expected) {
    if (node.ref?.direction === "inout") return false;
    if (node.kind !== "cell") return true;
    let rule = node.pinDirections?.[pin];
    if (!rule) {
      if (!ports.has(node.id)) ports.set(node.id, new Map((node.portDescriptors || []).map((port) => [port.pin, port])));
      const port = ports.get(node.id).get(pin);
      rule = node.pinDirections?.[port?.rawPin] || port;
    }
    return rule?.source !== "fallback-guarantee" && rule?.direction === expected;
  }
  function driverIssue(node, pin) {
    if (node.kind === "implicit") return "missing-driver";
    if (node.kind === "assign") return aliasDrivers.get(node.id)?.issue;
    return canUse(node, pin, "output") ? null : "ambiguous-pin-direction";
  }
  function propagate(edge, signal) {
    if (nodes.get(edge.target)?.kind !== "assign" || aliasDrivers.has(edge.target) || uncertain(edge)) return;
    aliasDrivers.set(edge.target, signal); pending.push(edge.target);
  }
  for (const edge of graph.edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source).push(edge);
    if (nodes.get(edge.target)?.kind !== "assign") continue;
    if (uncertain(edge) && !ambiguousAliases.has(edge.target)) {
      ambiguousAliases.add(edge.target); ambiguousQueue.push(edge.target);
    }
    const source = nodes.get(edge.source);
    if (source.kind !== "assign") {
      propagate(edge, { key: JSON.stringify([edge.source, edge.sourcePin]), fixed: fixedOutput(source, edge.sourcePin),
        issue: driverIssue(source, edge.sourcePin) });
    }
  }
  for (let i = 0; i < ambiguousQueue.length; i++) for (const edge of outgoing.get(ambiguousQueue[i]) || []) {
    if (nodes.get(edge.target)?.kind === "assign" && !ambiguousAliases.has(edge.target)) {
      ambiguousAliases.add(edge.target); ambiguousQueue.push(edge.target);
    }
  }
  for (let i = 0; i < pending.length; i++) for (const edge of outgoing.get(pending[i]) || []) propagate(edge, aliasDrivers.get(pending[i]));
  index = { nodes, outgoing, uncertain, aliasDrivers, driverIssue, canUse };
  sourceIndexes.set(graph, index);
  return index;
}

function cellRole(node) {
  if (node.kind !== "cell") return node.kind;
  return !node.referencedModuleName && ["and", "nand", "or", "nor", "inv", "buf", "xor", "xnor", "mux"].includes(node.gateKind)
    ? "gate" : "boundary";
}

export function createNetlistReconvergenceScope(fullGraph, graph) {
  const source = sourceIndex(fullGraph);
  const nodes = [], edges = [], reasons = new Set();
  const displayNodes = new Map(), displayEdges = new Map();
  const included = new Set(graph.nodes.map((node) => node.id).filter((id) => source.nodes.has(id)));
  for (const id of [...included].sort()) {
    const node = source.nodes.get(id);
    let role = cellRole(node);
    const alias = source.aliasDrivers.get(id);
    if (role === "assign" && (!alias || alias.issue)) role = "boundary";
    if (alias?.fixed) role = "constant";
    nodes.push({ id, role });
    displayNodes.set(id, { id, label: node.label || id });
  }
  const outputs = new Set(), mergeInputs = new Map();
  let visibleEdgeCount = 0;
  for (const id of included) {
    const node = source.nodes.get(id), role = cellRole(node);
    for (const edge of source.outgoing.get(id) || []) {
      if (!included.has(edge.target)) continue;
      visibleEdgeCount++;
      if (source.uncertain(edge)) { reasons.add("multiple-drivers"); continue; }
      const target = source.nodes.get(edge.target);
      const issue = source.driverIssue(node, edge.sourcePin);
      if (issue) { reasons.add(issue); continue; }
      if (!source.canUse(target, edge.targetPin, "input")) { reasons.add("ambiguous-pin-direction"); continue; }
      let driver = id;
      if (node.kind === "cell") {
        driver = "driver:" + JSON.stringify([id, edge.sourcePin]);
        if (!outputs.has(driver)) {
          outputs.add(driver);
          nodes.push({ id: driver, role: fixedOutput(node, edge.sourcePin) ? "constant" : "driver" });
          displayNodes.set(driver, { id, label: (node.label || id) + "." + edge.sourcePin });
          if (role === "gate" && !fixedOutput(node, edge.sourcePin)) edges.push({ id: "within:" + driver, source: id, target: driver });
        }
      }
      // Boundaries can start a new signal at an output. Incoming wires stop
      // at the boundary body and can never reach the output vertex.
      const key = "wire:" + JSON.stringify([driver, edge.net, edge.target, edge.targetPin]);
      if (displayEdges.has(key)) continue;
      const arc = { id: key, source: driver, target: edge.target };
      edges.push(arc);
      if (source.aliasDrivers.size && cellRole(target) === "gate") {
        // Transparent aliases of one physical driver feeding several input
        // pins are a single branch. Join them before the candidate gate.
        const physical = source.aliasDrivers.get(id)?.key || JSON.stringify([id, edge.sourcePin]);
        const terminal = "input-pin:" + JSON.stringify([edge.target, physical]);
        const first = mergeInputs.get(terminal);
        if (!first) mergeInputs.set(terminal, arc);
        else {
          if (!displayNodes.has(terminal)) {
            nodes.push({ id: terminal, role: "terminal" });
            displayNodes.set(terminal, displayNodes.get(edge.target));
            edges.push({ id: "within:" + terminal, source: terminal, target: edge.target });
            first.target = terminal;
          }
          arc.target = terminal;
        }
      }
      displayEdges.set(key, { id: edge.id, net: edge.net,
        label: displayNodes.get(driver).label + " → " + (target.label || target.id) + "." + edge.targetPin + " · " + edge.net });
    }
  }
  const compare = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  nodes.sort(compare); edges.sort(compare);
  const model = { nodes, edges, reasons: [...reasons].sort() };
  const hubInputs = new Map(), hubs = new Map();
  for (const edge of graph.edges) if (edge.id.endsWith(":hub-in")) hubInputs.set(edge.target, edge.id);
  for (const edge of graph.edges) if (edge.id.endsWith(":hub-out") && hubInputs.has(edge.source)) {
    hubs.set(edge.id.slice(0, -8), [hubInputs.get(edge.source), edge.id]);
  }
  return { model, displayNodes, displayEdges, visibleCount: included.size, visibleEdgeCount,
    unrouted: new Set(graph.unroutedNets || []), hubs };
}

export function sameNetlistReconvergenceScope(previous, current) {
  if (!previous) return false;
  const a = previous.model, b = current.model;
  return a.nodes.length === b.nodes.length && a.edges.length === b.edges.length && a.reasons.length === b.reasons.length &&
    a.reasons.every((reason, i) => reason === b.reasons[i]) &&
    a.nodes.every((node, i) => node.id === b.nodes[i].id && node.role === b.nodes[i].role) &&
    a.edges.every((edge, i) => edge.id === b.edges[i].id && edge.source === b.edges[i].source && edge.target === b.edges[i].target);
}
