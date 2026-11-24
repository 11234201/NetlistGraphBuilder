import { escapeHtml as h } from "./html.js";

const pageSize = 12;
const button = (action, label, disabled = false) =>
  `<button class="mini-button" type="button" data-recon-action="${h(action)}"${disabled ? " disabled" : ""}>${h(label)}</button>`;
const select = (result, scope, selected) => `<button class="recon-result" type="button" data-recon-result="${h(result.id)}" aria-pressed="${result.id === selected}">
  <span>${h(label(scope, result.stemId))}</span><span class="recon-arrow">→</span><span>${h(label(scope, result.mergeId))}</span></button>`;
const label = (scope, id) => scope.displayNodes.get(id)?.label || id;
function page(items, number, render, key) {
  const last = Math.max(0, Math.ceil(items.length / pageSize) - 1);
  const current = Math.max(0, Math.min(number, last));
  const rows = items.slice(current * pageSize, (current + 1) * pageSize).map(render).join("");
  const paging = last ? `<div class="recon-actions" data-recon-page="${h(key)}" data-current-page="${current + 1}" data-page-count="${last + 1}">${button(key + "-", "Previous", current === 0)} ${current + 1} / ${last + 1} ${button(key + "+", "Next", current === last)}</div>` : "";
  return rows + paging;
}

export function renderNetlistReconvergence({ panel, detail }, record, compare, side) {
  const tabs = compare ? `<div class="recon-actions">${button("left", "Side A", side === "left")}${button("right", "Side B", side === "right")}</div>` : "";
  const heading = `<h2>Reconvergence</h2>${tabs}`;
  if (!record?.scope) {
    panel.innerHTML = heading + `<p>${h(record?.scopeError || "No committed logic in this view.")}</p>` +
      (record?.scopeError ? button("retry-scope", "Retry") : "");
    detail.replaceChildren(); return;
  }
  const { manager, scope, context, selected, pageIndex, detailPage, nodeId, relatedPage } = record;
  const state = manager.read(), category = state.data?.reconvergence;
  const settled = ["complete", "partial"].includes(state.status);
  const results = settled ? category?.results || [] : [];
  const reasons = category?.reasons?.join(", ") || "";
  const result = results.find((item) => item.id === selected);
  const view = compare ? (side === "left" ? "Side A" : "Side B") + " · " : "";
  const summary = `${view}${context.unitId} · ${context.graph.view?.mode || "whole"} · ${scope.visibleCount} visible nodes`;
  const status = state.status === "partial" ? "Partial results" : state.status;
  panel.innerHTML = heading + `<p class="recon-scope">${h(summary)}</p>
    <div class="recon-status-row"><span role="status" data-recon-status="${h(state.status)}">${h(status)}${settled ? " · " + results.length + (results.length === 1 ? " result" : " results") : ""}</span>
    ${state.status === "running" ? button("cancel", "Cancel") : button("run", "Run again")}</div>` +
    (state.error || reasons ? `<p class="recon-note">${h(state.error || reasons)}</p>` : "") +
    (results.length ? page(results, pageIndex, (item) => select(item, scope, selected), "list") :
      settled ? "<p>No reconvergence found in the analyzed portion of this view.</p>" : "");
  const sections = [];
  if (result) {
    const rows = [], pathPage = record.pathPage;
    result.paths.forEach((path, i) => {
      const wires = path.edgeIds.filter((id) => scope.displayEdges.has(id));
      rows.push(`<section class="recon-path" data-path-branch="${i}"><h4>Path ${i + 1} <small>· ${path.depth} gates · ${wires.length} edges</small></h4>` +
        page(wires, pathPage[i], (id) => wireRow(scope, id), "path" + i) + "</section>");
    });
    const union = state.detail;
    const unionEdges = union?.edgeIds.filter((id) => scope.displayEdges.has(id)) || [];
    sections.push(`<h3>${h(view)}${h(label(scope, result.stemId))} → ${h(label(scope, result.mergeId))}</h3>
      <div class="recon-actions">${button("locate", "Locate")}${button("clear", "Clear")}</div>${rows.join("")}
      <h4>Connections between endpoints</h4><p>${h(state.detailError || state.detailStatus)} ${h(union?.reasons?.join(", "))}</p>` +
      (state.detailStatus === "error" ? button("retry-detail", "Retry detail") : "") +
      page(unionEdges, detailPage, (id) => wireRow(scope, id), "detail"));
  }
  if (nodeId && record.related?.has(nodeId)) {
    const related = record.related.get(nodeId);
    sections.push(`<h3>Related reconvergence · ${h(label(scope, nodeId))} (${related.length})</h3>` +
      page(related, relatedPage, (item) => select(item, scope, selected), "related"));
  }
  detail.innerHTML = sections.join("");
}

function wireRow(scope, id) {
  const wire = scope.displayEdges.get(id);
  return `<div class="recon-wire">${h(wire.label)}${scope.unrouted.has(wire.net) ? " (not routed)" : ""}</div>`;
}

export function highlightNetlistReconvergence(mount, record) {
  for (const element of mount.querySelectorAll("[data-recon-role]")) element.removeAttribute("data-recon-role");
  const { manager, scope, selected, context } = record;
  const state = manager.read();
  if (!["complete", "partial"].includes(state.status)) return;
  const result = state.data?.reconvergence.results.find((item) => item.id === selected);
  if (!result) return;
  const nodes = new Map(), edges = new Map();
  function mark(map, id, role) {
    const previous = map.get(id);
    map.set(id, previous && previous !== role && previous !== "region" ? "shared" : role);
  }
  const collect = (path, role) => {
    for (const id of path.nodeIds) mark(nodes, scope.displayNodes.get(id).id, role);
    for (const id of path.edgeIds) {
      const wire = scope.displayEdges.get(id);
      if (wire) for (const displayed of (scope.hubs.get(wire.id) || [wire.id])) mark(edges, displayed, role);
    }
  };
  if (state.detail) collect(state.detail, "region");
  result.paths.forEach((path, i) => collect(path, i ? "b" : "a"));
  for (const element of mount.querySelectorAll("[data-node-id]")) {
    const role = nodes.get(element.dataset.nodeId);
    if (role) element.dataset.reconRole = role;
  }
  // Individual segments own a subset of a physical net's logical edges.
  const routes = new Map((context.graph.wireRoutes || []).map((route) => [route.id, { route, next: 0 }]));
  for (const element of mount.querySelectorAll(".edge")) {
    const group = routes.get(element.dataset.wireRouteId);
    const ids = group?.route.segments[group.next++]?.logicalEdgeIds || [element.dataset.edgeId];
    const roles = new Set(ids.map((id) => edges.get(id)).filter(Boolean));
    if (roles.has("a") && roles.has("b")) roles.add("shared");
    for (const role of ["shared", "a", "b", "region"]) if (roles.has(role)) { element.dataset.reconRole = role; break; }
  }
}
