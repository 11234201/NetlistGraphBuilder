import { inspectGraphNode, inspectGraphNet } from "../analysis/graphInspector.js";
import { getCompareNodeName } from "../domains/netlist/compare_objects.js";

export function invalid(code, message, details) {
  return Object.assign(new Error(message), {code, ...details});
}
export function number(value, label) {
  if (value === "" || !Number.isFinite(Number(value))) throw invalid("INVALID_ARGUMENT", "Expected a finite " + label);
  return Number(value);
}
export function reference(value) {
  if (typeof value !== "string" || !value.startsWith("{")) return value;
  try { return JSON.parse(value); } catch { return value; }
}
export function checkScope(ref, view) {
  if (!ref || typeof ref !== "object") return;
  if (ref.documentId && ref.documentId !== view.documentId || ref.graphId && ref.graphId !== view.graphId ||
      ref.sourceRevision != null && ref.sourceRevision !== view.sourceRevision ||
      ref.side && ref.side !== ({left:"A", right:"B"})[view.side])
    throw invalid("STALE_REFERENCE", "Object reference belongs to another workspace");
}
export function resolveNetlistObject(view, value) {
  const ref = reference(value);
  checkScope(ref, view);
  const object = ref?.objectRef || ref;
  checkScope(object, view);
  if (object?.unitId && object.unitId !== view.moduleName || object?.moduleName && object.moduleName !== view.moduleName ||
      object?.rootModuleName && view.occurrence?.rootModuleName && object.rootModuleName !== view.occurrence.rootModuleName ||
      Array.isArray(object?.occurrencePath) && JSON.stringify(object.occurrencePath) !== JSON.stringify(view.occurrence?.occurrencePath || []))
    throw invalid("STALE_REFERENCE", "Object reference belongs to another module occurrence");
  const key = typeof object === "string" ? object : object?.localId || object?.id || object?.name;
  const graph = view.full;
  if (typeof key !== "string" || !key || !graph) throw invalid("OBJECT_NOT_FOUND", "Select an object in the current design");
  const kind = object?.kind;
  const targetNet = kind === "net" || key.startsWith("net:");
  const net = targetNet && key.startsWith("net:") ? key.slice(4) : key;
  if (!targetNet) {
    const exact = graph.nodes.find(node => node.id === key);
    if (exact && (!kind || kind === "node" || kind === exact.kind || kind === "port" && ["input","output"].includes(exact.kind)))
      return {kind:"node", id:exact.id, node:exact};
    const nodes = graph.nodes.filter(node => (!kind || kind === "node" || kind === node.kind || kind === "port" && ["input","output"].includes(node.kind))
      && (getCompareNodeName(node) === key || node.label === key));
    if (nodes.length === 1) return {kind:"node", id:nodes[0].id, node:nodes[0]};
    if (nodes.length > 1) throw invalid("AMBIGUOUS_OBJECT", "Use a canonical object ID", {candidates:nodes.map(node => node.id)});
  }
  if ((!kind || kind === "net") && (graph.edges.some(edge => edge.net === net) || graph.unroutedNets?.includes(net)))
    return {kind:"net",id:"net:" + net,name:net};
  throw invalid("OBJECT_NOT_FOUND", "Object is unavailable in this module");
}

export function objectRecord(view, item) {
  if (!item) return null;
  const node = item.node;
  return {id:item.id, kind:node?.kind || "net", name:node ? getCompareNodeName(node) : item.name,
    label:node?.label || item.name, moduleName:view.moduleName, rootModuleName:view.occurrence?.rootModuleName,
    occurrencePath:view.occurrence?.occurrencePath || [], documentId:view.documentId, sourceRevision:view.sourceRevision,
    side:view.side ? ({left:"A",right:"B"})[view.side] : null};
}

export function inspectNetlist(view, item, hierarchyContext) {
  const options = {hierarchyContext:view.side ? null : hierarchyContext()};
  return item.node ? inspectGraphNode(view.full, item.node, options) : inspectGraphNet(view.full, item.name, options);
}
export function pageRows(rows, page = "1", limit = 100) {
  const number = Number(page);
  if (!Number.isSafeInteger(number) || number < 1) throw invalid("INVALID_ARGUMENT", "Invalid page number");
  return {items:rows.slice((number - 1) * limit, number * limit), total:rows.length, page:number, pageSize:limit};
}

export function hierarchyRows(roots) {
  const rows = [];
  function visit(node, parent) {
    const occurrencePath = node.canonicalOccurrencePath;
    const id = JSON.stringify([node.rootModuleName, ...occurrencePath]);
    rows.push({id, parent, rootModuleName:node.rootModuleName, moduleName:node.moduleName, instanceName:node.instanceName,
      label:node.moduleLabel, occurrencePath, displayPath:node.occurrencePath, cycle:node.cycle, truncated:node.truncated});
    for (const child of node.children) visit(child, id);
  }
  for (const root of roots) visit(root, null);
  return rows;
}
