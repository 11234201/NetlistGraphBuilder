import { escapeAttr, escapeHtml, renderDefinitionRows } from "./html.js";

export function renderObjectDetails(inspection) {
  if (!inspection) {
    return "";
  }
  return `<dl class="stats-list">${renderDefinitionRows(inspection.summary)}</dl>${renderConnections(inspection.connections)}${renderHierarchyConnections(inspection.hierarchyConnections)}${renderTraversal(inspection.traversal)}`;
}

function renderTraversal(traversal) {
  if (!traversal?.length) {
    return "";
  }
  const rows = traversal.map((item) => `<tr>
    <th>${escapeHtml(item.label)}</th>
    <td>${renderTargets(item.immediateTargets, item.immediate.join(", ") || "-")}</td>
    <td>${escapeHtml(item.transitiveCount)}</td>
    <td>${escapeHtml(item.maxDepth)}</td>
  </tr>`).join("");
  return `<section class="connection-section">
    <h3>Traversal</h3>
    <div class="connection-table-wrap">
      <table class="connection-table traversal-table">
        <thead><tr><th>Dir</th><th>Immediate</th><th>Nodes</th><th>Depth</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function renderConnections(connections) {
  if (!connections?.length) {
    return "";
  }
  const rows = connections.map((connection) => `<tr>
    <td><code>${escapeHtml(connection.pin)}</code></td>
    <td>${escapeHtml(connection.direction)}</td>
    <td>${renderTarget(connection.netTarget, connection.net)}</td>
    <td>${renderTargets(connection.peerTargets, connection.peers)}</td>
  </tr>`).join("");

  return `<section class="connection-section">
    <h3>Connections <span class="connection-scope-label">Current module</span></h3>
    <div class="connection-table-wrap">
      <table class="connection-table">
        <thead><tr><th>Pin</th><th>Dir</th><th>Net</th><th>Connected</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function renderHierarchyConnections(connections) {
  if (!connections?.length) return "";
  const rows = connections.map((connection) => `<tr>
    <td><span class="hierarchy-scope-badge">${escapeHtml(connection.scope)}</span></td>
    <td><code>${escapeHtml(connection.boundary)}</code></td>
    <td>${escapeHtml(connection.portDirection)} · ${escapeHtml(connection.flow)}</td>
    <td>${renderTarget(connection.target)}</td>
  </tr>`).join("");
  return `<section class="connection-section hierarchy-connection-section">
    <h3>Hierarchy <span class="connection-scope-label">Parent occurrence</span></h3>
    <div class="hierarchy-connection-note">Crosses the current module boundary to its parent occurrence.</div>
    <div class="connection-table-wrap">
      <table class="connection-table hierarchy-connection-table">
        <thead><tr><th>Scope</th><th>Boundary</th><th>Dir</th><th>Connected</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function renderTargets(targets, fallback = "-") {
  if (!targets?.length) return `<code>${escapeHtml(fallback || "-")}</code>`;
  return targets.map((target) => renderTarget(target)).join(`<span class="selection-link-separator">, </span>`);
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
  return `<button class="selection-link" type="button" data-selection-target-kind="${escapeAttr(target.kind)}" ${valueAttribute}${hierarchyAttributes} title="定位到 ${escapeAttr(label)}"><code>${escapeHtml(label)}</code></button>`;
}
