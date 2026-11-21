import { INSPECTION_ROW_PAGE_SIZE, INSPECTION_TARGET_PAGE_SIZE } from "../ui/objectDetailsPanel.js";
import { inspectNetlist, invalid, objectRecord, pageRows, reference, resolveNetlistObject } from "./remote_object_queries.js";

function connectionGroup(inspection, group) {
  const {connections = [],hierarchyConnections = [],traversal = []} = inspection;
  const rows = {connections,pins:connections,parent:hierarchyConnections,hierarchy:hierarchyConnections,traversal,
    driver:connections.filter(row => row.pin === "driver"),load:connections.filter(row => row.pin === "load")};
  if (Object.hasOwn(rows,group)) return [rows[group],INSPECTION_ROW_PAGE_SIZE];
  const byDirection = traversal.find(row => row.label.toLowerCase() === group);
  if (byDirection) return [byDirection.immediateTargets,INSPECTION_TARGET_PAGE_SIZE];
  const nested = /^(peers|traversal):(\d+)$/.exec(group);
  const targets = nested && (nested[1] === "peers" ? connections[Number(nested[2])]?.peerTargets : traversal[Number(nested[2])]?.immediateTargets);
  if (targets) return [targets,INSPECTION_TARGET_PAGE_SIZE];
  throw invalid("INVALID_ARGUMENT","Unknown connection group");
}

function scopedInspection(inspection, object) {
  const scope = {documentId:object.documentId,sourceRevision:object.sourceRevision,side:object.side,origin:object};
  const scoped = target => target && {...scope,...target};
  return {...inspection, connections:(inspection.connections || []).map(row => ({...row,netTarget:scoped(row.netTarget),
    peerTargets:row.peerTargets?.map(scoped)})),
    hierarchyConnections:(inspection.hierarchyConnections || []).map(row => ({...row,target:scoped(row.target)})),
    traversal:(inspection.traversal || []).map(row => ({...row,immediateTargets:row.immediateTargets?.map(scoped)}))};
}

export function readRemoteInspection(job,view,hierarchyContext) {
  const {name,args,opts} = job;
  const ref = reference(args[0] || view.selected);
  const item = resolveNetlistObject(view,ref), object = objectRecord(view,item);
  if (name === "inspect copy") {
    const field = ref?.field || "name";
    if (!["name","id","label"].includes(field)) throw invalid("FIELD_NOT_FOUND","No such object name field");
    return object[field];
  }
  if (name === "inspect tooltip") {
    const selector = item.node ? `[data-node-id="${CSS.escape(item.id)}"]` : `[data-net="${CSS.escape(item.name)}"]`;
    const rendered = view.mount?.querySelector(selector);
    if (ref?.pin !== undefined) {
      const positioned = view.graph?.nodes.find(n => n.id === item.id);
      const index = positioned?.ports?.findIndex(port => port.pin === ref.pin);
      if (index === undefined || index < 0) throw invalid("PIN_NOT_FOUND","Pin is unavailable in the active view");
      const port = positioned.ports[index], marker = rendered?.querySelectorAll(".pin-dot,.pin-bubble")[index];
      const tooltip = marker?.querySelector("title")?.textContent;
      return {object,pin:port.pin,text:tooltip || [port.pin,port.direction,port.net].filter(Boolean).join(" · ")};
    }
    return {object,text:rendered?.querySelector(":scope > title")?.textContent || item.node?.title || object.label};
  }
  const inspection = scopedInspection(inspectNetlist(view,item,hierarchyContext),object);
  if (name === "inspect connections") {
    const group = opts.group || "connections";
    const [rows,size] = connectionGroup(inspection,group);
    return {...pageRows(rows,opts["page-number"],size),object,group};
  }
  const fields = {summary:inspection.summary,properties:inspection.definitionRows || [],attributes:inspection.attributes || [],
    connections:inspection.connections,timing:item.node?.timing || view.full?.edges.find(edge => edge.net === item.name)?.timing || null,
    source:object,analysis:inspection.traversal};
  if (opts.tab && !Object.hasOwn(fields,opts.tab)) throw invalid("INVALID_ARGUMENT","Unknown inspector tab");
  return {object,...(opts.tab ? {[opts.tab]:fields[opts.tab]} : {...fields,hierarchyConnections:inspection.hierarchyConnections})};
}
