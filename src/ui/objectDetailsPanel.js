import { escapeAttr, escapeHtml, renderDefinitionRows } from "./html.js";

export function renderObjectDetails(inspection) {
  if (!inspection) {
    return "";
  }
  return `<dl class="stats-list">${renderDefinitionRows(inspection.summary)}</dl>${renderConnections(inspection.connections)}${renderTraversal(inspection.traversal)}`;
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
    <h3>Connections</h3>
    <div class="connection-table-wrap">
      <table class="connection-table">
        <thead><tr><th>Pin</th><th>Dir</th><th>Net</th><th>Connected</th></tr></thead>
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
  return `<button class="selection-link" type="button" data-selection-target-kind="${escapeAttr(target.kind)}" ${valueAttribute} title="定位到 ${escapeAttr(label)}"><code>${escapeHtml(label)}</code></button>`;
}
