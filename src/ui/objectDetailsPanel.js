import { escapeAttr, escapeHtml, renderDefinitionRows } from "./html.js";

export const INSPECTION_ROW_PAGE_SIZE = 100;
export const INSPECTION_TARGET_PAGE_SIZE = 20;

export function renderObjectDetails(inspection, options = {}) {
  if (!inspection) {
    return "";
  }
  const label = options.label || inspection.summary.find(([key]) => key === "Label" || key === "Name")?.[1] || "Selected object";
  const canonicalName = options.canonicalName || label;
  const summary = inspection.summary.filter(([key]) => !["Label", "Name"].includes(key)).map(([key, value]) => {
    if (inspection.kind !== "net" || (key !== "Driver" && key !== "Loads")) return [key, value];
    const role = key === "Driver" ? "driver" : "load";
    const count = inspection.connections?.filter((item) => item.pin === role).length || 0;
    return [key, `${count} connection(s); see Connections`];
  });
  return `<header class="inspector-object-header" data-inspector-summary data-selection-identity="${escapeAttr(options.identity || `${inspection.kind}:${canonicalName}`)}">
    ${options.scope ? `<div class="inspector-object-scope">${escapeHtml(options.scope)}</div>` : ""}
    <div class="inspector-object-name"><strong data-selection-label title="${escapeAttr(label)}">${escapeHtml(label)}</strong>
      <button class="mini-button inspector-copy-button" type="button" data-inspector-copy="${escapeAttr(canonicalName)}" title="Copy canonical name" aria-label="Copy canonical name">Copy</button></div>
    ${canonicalName !== label ? `<details class="inspector-canonical-name"><summary>Canonical name</summary><code>${escapeHtml(canonicalName)}</code></details>` : ""}
    <dl class="stats-list inspector-object-summary">${renderDefinitionRows(summary)}</dl>
    <span class="inspector-copy-status" data-inspector-copy-status role="status"></span>
  </header><section data-inspector-section="connections" data-object-connections aria-label="Connections">
    ${options.connectionTools || ""}${renderConnections(inspection.connections, options.pages)}${renderHierarchyConnections(inspection.hierarchyConnections, options.pages)}${renderTraversal(inspection.traversal, options.pages)}
    ${inspection.connections?.length ? "" : "<p class=\"details-empty\">No connections available in this view.</p>"}</section>`;
}

function renderTraversal(traversal, pages = {}) {
  if (!traversal?.length) {
    return "";
  }
  const rows = traversal.map((item, index) => `<tr>
    <th>${escapeHtml(item.label)}</th>
    <td><div data-inspection-list="traversal:${index}">${renderTargets(item.immediateTargets, item.immediate.join(", ") || "-", `traversal:${index}`, pages)}</div></td>
    <td>${escapeHtml(item.transitiveCount)}</td>
    <td>${escapeHtml(item.maxDepth)}</td>
  </tr>`).join("");
  return `<section class="connection-section">
    <h3>Traversal</h3>
    <div class="connection-table-wrap" tabindex="0" role="region" aria-label="Traversal table">
      <table class="connection-table traversal-table">
        <thead><tr><th>Dir</th><th>Immediate</th><th>Nodes</th><th>Depth</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function renderConnections(connections, pages = {}) {
  if (!connections?.length) {
    return "";
  }
  const { page, start, items } = getPage(connections, "connections", pages, INSPECTION_ROW_PAGE_SIZE);
  const rows = items.map((connection, index) => `<tr>
    <td><code>${escapeHtml(connection.pin)}</code></td>
    <td>${escapeHtml(connection.direction)}</td>
    <td>${renderTarget(connection.netTarget, connection.net)}</td>
    <td><div data-inspection-list="peers:${start + index}">${renderTargets(connection.peerTargets, connection.peers, `peers:${start + index}`, pages)}</div></td>
  </tr>`).join("");

  return `<section class="connection-section">
    <h3>Connections <span class="connection-scope-label">Current module</span></h3>
    <div data-inspection-list="connections"><div class="connection-table-wrap" tabindex="0" role="region" aria-label="Current module connections table">
      <table class="connection-table">
        <thead><tr><th>Pin</th><th>Dir</th><th>Net</th><th>Connected</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>${renderPager(connections.length, "connections", page, INSPECTION_ROW_PAGE_SIZE)}</div>
  </section>`;
}

function renderHierarchyConnections(connections, pages = {}) {
  if (!connections?.length) return "";
  const { page, items } = getPage(connections, "hierarchy", pages, INSPECTION_ROW_PAGE_SIZE);
  const rows = items.map((connection) => `<tr>
    <td><span class="hierarchy-scope-badge">${escapeHtml(connection.scope)}</span></td>
    <td><code>${escapeHtml(connection.boundary)}</code></td>
    <td>${escapeHtml(connection.portDirection)} · ${escapeHtml(connection.flow)}</td>
    <td>${renderTarget(connection.target)}</td>
  </tr>`).join("");
  return `<section class="connection-section hierarchy-connection-section">
    <h3>Hierarchy <span class="connection-scope-label">Parent occurrence</span></h3>
    <div class="hierarchy-connection-note">Crosses the current module boundary to its parent occurrence.</div>
    <div data-inspection-list="hierarchy"><div class="connection-table-wrap" tabindex="0" role="region" aria-label="Parent occurrence connections table">
      <table class="connection-table hierarchy-connection-table">
        <thead><tr><th>Scope</th><th>Boundary</th><th>Dir</th><th>Connected</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>${renderPager(connections.length, "hierarchy", page, INSPECTION_ROW_PAGE_SIZE)}</div>
  </section>`;
}

function renderTargets(targets, fallback = "-", group, pages = {}) {
  if (!targets?.length) return `<code>${escapeHtml(fallback || "-")}</code>`;
  const { page, items } = getPage(targets, group, pages, INSPECTION_TARGET_PAGE_SIZE);
  return items.map((target) => renderTarget(target)).join(`<span class="selection-link-separator">, </span>`)
    + renderPager(targets.length, group, page, INSPECTION_TARGET_PAGE_SIZE);
}

function renderTarget(target, fallback = "-") {
  if (!target) return `<code>${escapeHtml(fallback || "-")}</code>`;
  const valueAttribute = target.kind === "net"
    ? `data-selection-target-name="${escapeAttr(target.name)}"`
    : `data-selection-target-id="${escapeAttr(target.id)}"`;
  const label = target.label || target.name || target.id || fallback;
  const hierarchyAttributes = target.moduleName
    ? ` data-selection-target-module="${escapeAttr(target.moduleName)}" data-selection-target-root-module="${escapeAttr(target.rootModuleName || target.moduleName)}" data-selection-target-occurrence="${escapeAttr(JSON.stringify(target.occurrencePath || []))}"`
    : "";
  return `<button class="selection-link" type="button" data-selection-target-kind="${escapeAttr(target.kind)}" ${valueAttribute}${hierarchyAttributes} title="Locate ${escapeAttr(label)}"><code>${escapeHtml(label)}</code></button>`;
}

function getPage(items, group, pages, size) {
  const page = Math.min(Math.max(0, pages[group] || 0), Math.max(0, Math.ceil(items.length / size) - 1));
  const start = page * size;
  return { page, start, items: items.slice(start, start + size) };
}

function renderPager(total, group, page, size) {
  if (total <= size) return "";
  const start = page * size;
  return `<div class="inspection-pagination" aria-label="Connection list pages">
    <span>${start + 1}–${Math.min(start + size, total)} of ${total}</span>
    <button class="mini-button" type="button" data-inspection-page-group="${escapeAttr(group)}" data-inspection-page="${page - 1}"${page === 0 ? " disabled" : ""}>Previous</button>
    <button class="mini-button" type="button" data-inspection-page-group="${escapeAttr(group)}" data-inspection-page="${page + 1}"${start + size >= total ? " disabled" : ""}>Next</button>
  </div>`;
}

export function bindObjectDetailsPanel(container, inspection) {
  const panel = container.querySelector?.("[data-object-connections]");
  if (!panel?.querySelector || !panel?.addEventListener) return;
  const pages = {};
  panel.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-inspection-page-group]");
    if (!button || !panel.contains(button)) return;
    const group = button.dataset.inspectionPageGroup;
    const page = Number(button.dataset.inspectionPage);
    if (!Number.isInteger(page) || page < 0) return;
    pages[group] = page;
    const list = [...panel.querySelectorAll("[data-inspection-list]")].find((item) => item.dataset.inspectionList === group);
    if (!list) return;
    // Pagination owns these read-only lists; routing and edit controls retain their bindings.
    if (group === "connections" || group === "hierarchy") {
      const render = group === "connections" ? renderConnections : renderHierarchyConnections;
      list.parentElement.outerHTML = render(group === "connections" ? inspection.connections : inspection.hierarchyConnections, pages);
    } else {
      const [kind, rawIndex] = group.split(":");
      const index = Number(rawIndex);
      const item = kind === "peers" ? inspection.connections?.[index] : kind === "traversal" ? inspection.traversal?.[index] : null;
      if (!item) return;
      list.innerHTML = kind === "peers" ? renderTargets(item.peerTargets, item.peers, group, pages)
        : renderTargets(item.immediateTargets, item.immediate.join(", ") || "-", group, pages);
    }
    const updated = [...panel.querySelectorAll("[data-inspection-list]")].find((item) => item.dataset.inspectionList === group);
    const focusTarget = [...(updated?.querySelectorAll("[data-inspection-page-group]") || [])]
      .find((item) => item.dataset.inspectionPageGroup === group && !item.disabled);
    focusTarget?.focus({ preventScroll: true });
  });
}
