import { escapeHtml, renderDefinitionRows } from "./html.js";

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
    <td>${escapeHtml(item.immediate.join(", ") || "-")}</td>
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
    <td><code>${escapeHtml(connection.net)}</code></td>
    <td><code>${escapeHtml(connection.peers)}</code></td>
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
