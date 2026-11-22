import { escapeAttr, escapeHtml, renderDefinitionRows } from "./html.js";
import { aigObjectLabel } from "./aig_object_label.js";
import { renderAigStructureNavigator, renderAigStructureInspector, renderAigStructureMembership } from "./aig_structure_panels.js";

export const AIG_PANEL_PAGE_SIZE = 100;

// The document query owns the indexes. Selection changes reuse the last
// filtered/sorted result instead of scanning the model on every click.
const panelIndexes = new WeakMap();

export function renderAigNavigator(workspace, options = {}) {
  if (!workspace?.document?.model) return '<p class="details-empty">Open an ABC AIG DOT or two-input BLIF file.</p>';
  const entries = [["design", "Design"], ["objects", "Objects"], ["analysis", "Analysis"], ["path", "Path"]];
  if (workspace.document.model.nameMappings?.length) entries.push(["names", "Names"]);
  const tab = entries.some(([id]) => id === options.tab) ? options.tab : "design";
  const tabs = renderTabs("nav", entries, tab);
  if (tab === "path") return tabs;
  if (tab === "names") return `${tabs}<section data-aig-nav-content="names">${renderNames(workspace, options)}</section>`;
  return `${tabs}<section data-aig-nav-content="${tab}">${tab === "design"
    ? renderDesign(workspace, options) : tab === "analysis" ? renderAigStructureNavigator(workspace, options.structure) : renderObjects(workspace, options)}</section>`;
}

export function renderAigInspector(workspace, options = {}) {
  const structure = renderAigStructureInspector(workspace, options.structure);
  if (structure) return structure;
  const context = workspace?.document?.model ? getIndexes(workspace) : null;
  const selected = context?.query.getObject(options.selectedId);
  const tab = ["analysis", "source"].includes(options.tab) ? options.tab : "connections";
  const tabs = renderTabs("inspector", [["connections", "Connections"], ["analysis", "Analysis"], ["source", "Source"]], tab);
  if (!selected) return `${tabs}<p class="details-empty">Select an object in the canvas or Navigator.</p>`;
  const isEdge = context.query.edgeById.has(selected.id);
  const name = isEdge ? edgeLabel(selected, context) : selected.label;
  const type = isEdge ? "Logical edge" : kindLabel(selected.kind);
  const mapping = selected.primaryNameMapping || selected.nameMappings?.[0];
  const header = `<header class="inspector-object-header" data-aig-inspected-id="${escapeAttr(selected.id)}">
    <div class="inspector-object-name"><strong title="${escapeAttr(name)}">${escapeHtml(name)}</strong>${copyButton(name)}</div>
    <dl class="stats-list">${renderDefinitionRows([["Type", type], ["File", workspace.document.name], ["Object ID", selected.id],
      ...(mapping ? [[mapping.conflict ? "Conflicting mapped name" : selected.primaryNameMapping ? "Mapped name" : "Mapped alias", mapping.name],
        ["BLIF signal", mapping.signalId], ["Mapping polarity", mapping.inverted ? "Inverted" : "Positive"]] : []),
      ...(selected.sourceRefs?.[0]?.generatedFor ? [["Generated for .names", selected.sourceRefs[0].generatedFor]] : [])])}</dl>
    <button type="button" class="mini-button" data-aig-zoom="${escapeAttr(selected.id)}">Zoom to selection</button>
  </header>`;
  const content = tab === "analysis" ? renderAnalysis(workspace, selected, isEdge, options)
    : tab === "source" ? renderSource(selected, isEdge, options)
      : renderConnections(workspace, selected, isEdge, options);
  return `${header}${tabs}<section data-aig-inspector-content="${tab}">${content}</section>`;
}

export function revealAigNavigatorSelection(workspace, options, selectedId, fanoutThreshold = options?.fanoutThreshold) {
  let next = { ...options, tab: "objects" };
  let { context } = getObjectView(workspace, { ...next, fanoutThreshold });
  if (!context.query.nodeById.has(selectedId)) return next;
  if (!context.objectPositions.has(selectedId)) {
    next = { ...next, type: "all", query: "", analysisFilter: "all" };
    ({ context } = getObjectView(workspace, { ...next, fanoutThreshold }));
  }
  return { ...next, page: Math.floor(context.objectPositions.get(selectedId) / AIG_PANEL_PAGE_SIZE) };
}

function getIndexes(workspace) {
  let context = panelIndexes.get(workspace.query);
  if (!context) {
    context = { query: workspace.query, objectsKey: null, objects: [], fanoutCounts: new Map() };
    panelIndexes.set(workspace.query, context);
  }
  return context;
}

function thresholdOf(options) {
  const value = Number(options.fanoutThreshold);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 2;
}

function renderDesign(workspace, options) {
  const { name, format, analysis, levelFile } = workspace.document;
  const threshold = thresholdOf(options);
  const context = getIndexes(workspace);
  let highFanout = context.fanoutCounts.get(threshold);
  if (highFanout === undefined) {
    highFanout = Object.values(analysis.fanout).filter((count) => count >= threshold).length;
    // A user may enter arbitrary thresholds; keep this presentation cache bounded.
    if (context.fanoutCounts.size >= 8) context.fanoutCounts.clear();
    context.fanoutCounts.set(threshold, highFanout);
  }
  const counts = analysis.counts;
  return `<h3 title="${escapeAttr(name)}">${escapeHtml(name)}</h3><dl class="stats-list">${renderDefinitionRows([
    ["Format", ["dot", "abc-dot"].includes(format) ? "ABC AIG DOT" : "Two-input BLIF"], ["Inputs (PI)", counts.pi], ["AND", counts.and],
    ["Outputs (PO)", counts.po], ["Constants", counts.constant], ["Logical edges", counts.edges],
    ["Inverted edges", counts.invertedEdges], [levelFile ? "Maximum output level" : "Maximum AND depth", analysis.depth],
    ...(levelFile ? [["Level file", levelFile.name], ["Reported points", levelFile.pointCount]] : []),
    ["Critical nodes", analysis.criticalNodes.length], ["Critical edges", analysis.criticalEdges.length],
    [`Fanout ≥ ${threshold}`, highFanout]
  ])}</dl>`;
}

function getObjectView(workspace, options) {
  const context = getIndexes(workspace);
  const { analysis } = workspace.document;
  const type = ["all", "pi", "po", "and", "constant"].includes(options.type) ? options.type : "ports";
  const query = String(options.query || "");
  const analysisFilter = ["critical", "fanout"].includes(options.analysisFilter) ? options.analysisFilter : "all";
  const sort = ["depth", "fanout"].includes(options.sort) ? options.sort : "name";
  const threshold = thresholdOf(options);
  const key = JSON.stringify([type, query, analysisFilter, sort, threshold]);
  if (key !== context.objectsKey) {
    context.objects = workspace.search(query, Number.MAX_SAFE_INTEGER).filter((entry) => {
      return (type === "all" || type === "ports" && ["pi", "po"].includes(entry.kind) || type === entry.kind)
        && (analysisFilter !== "critical" || context.query.criticalNodes.has(entry.id))
        && (analysisFilter !== "fanout" || (analysis.fanout[entry.id] || 0) >= threshold);
    }).sort((left, right) => {
      const difference = sort === "depth" ? context.query.nodeById.get(right.id).level - context.query.nodeById.get(left.id).level
        : sort === "fanout" ? (analysis.fanout[right.id] || 0) - (analysis.fanout[left.id] || 0) : 0;
      return difference || compareText(left.label, right.label) || compareText(left.id, right.id);
    });
    context.objectPositions = new Map(context.objects.map(({ id }, index) => [id, index]));
    context.objectsKey = key;
  }
  return { context, type, query, analysisFilter, sort, threshold };
}

function renderObjects(workspace, options) {
  const { context, type, query, analysisFilter, sort, threshold } = getObjectView(workspace, options);
  const { analysis, levelFile } = workspace.document;
  const { page, start, end } = pageRange(context.objects.length, options.page);
  const selected = context.query.nodeById.get(options.selectedId);
  const selectedPosition = context.objectPositions.get(selected?.id);
  const excluded = selected && selectedPosition === undefined;
  const offPage = selected && !excluded && (selectedPosition < start || selectedPosition >= end);
  const rows = context.objects.slice(start, end).map((entry) => {
    const node = context.query.nodeById.get(entry.id);
    const current = entry.id === options.selectedId;
    return `<li><button type="button" class="module-hierarchy-link${current ? " is-current" : ""}" data-aig-select="${escapeAttr(entry.id)}" title="${escapeAttr(entry.label)}"${current ? ' aria-current="true"' : ""}>
      <span>${escapeHtml(entry.label)}</span> <small>${entry.detail ? escapeHtml(entry.detail) + " · " : ""}${escapeHtml(kindLabel(entry.kind))} · ${levelFile ? "topology level" : "depth"} ${escapeHtml(node.level)} · fanout ${escapeHtml(analysis.fanout[entry.id] || 0)}${outsideScope(workspace.visibleNodeIds, node.id, workspace.path?.nodeIds)}</small>
    </button></li>`;
  }).join("");
  return `<div class="aig-object-filters">
    <label>Name or source ID <input type="search" data-aig-filter="query" value="${escapeAttr(query)}" autocomplete="off"></label>
    ${renderSelect("type", "Type", [["ports", "Inputs / outputs"], ["all", "All objects"], ["pi", "Inputs"], ["po", "Outputs"], ["and", "AND"], ["constant", "Constants"]], type)}
    ${renderSelect("analysisFilter", "Analysis", [["all", "All"], ["critical", "Critical path"], ["fanout", `Fanout ≥ ${threshold}`]], analysisFilter)}
    ${renderSelect("sort", "Sort", [["name", "Name"], ["depth", levelFile ? "Topology level (highest first)" : "Depth (highest first)"], ["fanout", "Fanout (highest first)"]], sort)}
  </div>${excluded || offPage ? `<p class="details-empty">${excluded ? "Current selection is outside the filter." : "Current selection is on another page."} <button type="button" data-aig-show-selection="${escapeAttr(selected.id)}">Show selection</button></p>` : ""}
  <p>${context.objects.length} objects</p><ul class="module-hierarchy-tree aig-object-list">${rows}</ul>
  ${context.objects.length ? renderPager(context.objects.length, page, "navigator") : '<p class="details-empty">No matching objects.</p>'}`;
}

function outsideScope(visible, id, path) {
  if (path && !path.has(id)) return " · outside Show Path";
  return visible && !visible.has(id) ? " · outside Focused" : "";
}

function nameRecords(workspace, options) {
  const query = String(options.nameQuery || "").trim().toLowerCase();
  const context = getIndexes(workspace);
  if (context.nameQuery !== query) {
    const words = query.split(/\s+/).filter(Boolean);
    const all = workspace.document.model.nameMappings;
    context.names = words.length ? all.filter((row) => {
      const text = `${row.signalId} ${row.name} ${row.nodeId || ""}`.toLowerCase();
      return words.every((word) => text.includes(word));
    }) : all;
    context.nameQuery = query;
  }
  return context.names;
}

export function readAigNavigatorPage(workspace, options) {
  const entries = options.tab === "names" ? nameRecords(workspace, options) : getObjectView(workspace, options).context.objects;
  const {page,start,end} = pageRange(entries.length, options.page);
  return {page:page + 1, total:entries.length, entries:entries.slice(start,end)};
}

function renderNames(workspace, options) {
  const query = String(options.nameQuery || "").trim().toLowerCase();
  const names = nameRecords(workspace, options);
  const { start, end, page } = pageRange(names.length, options.page);
  const rows = names.slice(start, end).map((row) => {
    const node = workspace.query.nodeById.get(row.nodeId);
    const target = node ? `<button type="button" class="selection-link" data-aig-select="${escapeAttr(node.id)}">${escapeHtml(node.id)}</button>${outsideScope(workspace.visibleNodeIds, node.id, workspace.path?.nodeIds)}` : "—";
    const usage = row.usage === "unknown" ? "Undeclared" : row.usage === "output" ? "Output port" : "Driver";
    return `<tr><td>${escapeHtml(row.signalId)}</td><td>${escapeHtml(row.name)}${copyButton(row.name)}</td><td>${target}</td><td>${usage}${row.inverted ? " · inverted" : ""}${row.conflict ? " · conflicting names" : ""}</td><td>${escapeHtml(row.line)}</td></tr>`;
  }).join("");
  return `<label>Filter names <input type="search" data-aig-filter="nameQuery" value="${escapeAttr(options.nameQuery || "")}"></label>
    <p>${names.length} mappings</p><div class="connection-table-wrap" tabindex="0"><table class="connection-table"><thead><tr><th>BLIF ID</th><th>Mapped name</th><th>Canvas ID</th><th>Use</th><th>Line</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${renderPager(names.length, page, "navigator")}`;
}

function renderConnections(workspace, object, isEdge, options) {
  const { query } = getIndexes(workspace);
  const { analysis } = workspace.document;
  if (isEdge) return renderEdgeDetails(object, query);
  const incoming = analysis.incoming[object.id] || [];
  const outgoing = analysis.outgoing[object.id] || [];
  const count = incoming.length + outgoing.length;
  const { page, start, end } = pageRange(count, options.page);
  let rows = "";
  for (let index = start; index < end; index += 1) {
    const isIncoming = index < incoming.length;
    const edge = query.edgeById.get(isIncoming ? incoming[index] : outgoing[index - incoming.length]);
    rows += `<tr><td>${isIncoming ? "Fanin" : "Fanout"}</td><td>${nodeButton(query.nodeById.get(edge.source))} → ${nodeButton(query.nodeById.get(edge.target))}${outsideScope(workspace.visibleEdgeIds, edge.id, workspace.path?.edgeIds)}</td>
      <td><button type="button" class="selection-link" data-aig-select="${escapeAttr(edge.id)}">Slot ${escapeHtml(edge.slot)}</button></td>
      <td>${edge.inverted ? "Inverted" : "Positive"}</td><td>${query.criticalEdges.has(edge.id) ? "Critical" : "—"}</td></tr>`;
  }
  return `<p>${incoming.length} fanin references · ${outgoing.length} fanout references</p>${count
    ? `<div class="connection-table-wrap" tabindex="0" role="region" aria-label="AIG connections"><table class="connection-table"><thead><tr><th>Direction</th><th>Endpoints</th><th>Input slot</th><th>Polarity</th><th>Path</th></tr></thead><tbody>${rows}</tbody></table></div>${renderPager(count, page, "inspector")}`
    : '<p class="details-empty">No connections.</p>'}`;
}

function renderEdgeDetails(edge, query) {
  return `<dl class="stats-list">${renderDefinitionRows([["Input slot", edge.slot], ["Polarity", edge.inverted ? "Inverted (dashed)" : "Positive"], ["Logical critical path", query.criticalEdges.has(edge.id) ? "Yes" : "No"]])}</dl>
    <p>Source ${nodeButton(query.nodeById.get(edge.source))}</p><p>Target ${nodeButton(query.nodeById.get(edge.target))}</p>`;
}

function renderAnalysis(workspace, object, isEdge, options) {
  const { analysis, levelFile } = workspace.document;
  const { query } = getIndexes(workspace);
  const threshold = thresholdOf(options);
  const rows = isEdge ? [["Logical critical edge", query.criticalEdges.has(object.id) ? "Yes" : "No"],
    [levelFile ? "Source topology level" : "Source depth", query.nodeById.get(object.source).level],
    [levelFile ? "Target topology level" : "Target depth", query.nodeById.get(object.target).level], ["Polarity", object.inverted ? "Inverted" : "Positive"]]
    : [[levelFile ? "Topology level" : "AND depth", object.level], ["Fanout references", analysis.fanout[object.id] || 0], ["Logical critical path", query.criticalNodes.has(object.id) ? "Yes" : "No"],
      ["High fanout threshold", threshold], ["Threshold reached", (analysis.fanout[object.id] || 0) >= threshold ? "Yes" : "No"]];
  const report = object.levelReport;
  if (report) {
    rows.push(["Reported AT level", report.at ?? "—"], ["Reported RT level", report.rt ?? "—"],
      [report.slackDerived ? "Slack level (RT − AT)" : "Reported Slack level", report.slack ?? "—"]);
  }
  return `<dl class="stats-list">${renderDefinitionRows(rows)}</dl>${renderAigStructureMembership(workspace, object, options.structure)}`;
}

function renderSource(object, isEdge, options) {
  const refs = object.sourceRefs || [];
  const mappings = object.nameMappings || [];
  const count = Math.max(refs.length, mappings.length);
  const { page, start, end } = pageRange(count, options.page);
  const names = mappings.slice(start, end).map((row) => `<li>${escapeHtml(row.signalId)} → ${escapeHtml(row.name)}${copyButton(row.name)} · ${row.inverted ? "Inverted" : "Positive"} · line ${escapeHtml(row.line)}${row.conflict ? " · conflicting names" : ""}</li>`).join("");
  return `<p>Normalized ID <code>${escapeHtml(object.id)}</code>${copyButton(object.id)}</p>${refs.length
    ? `<ul class="aig-source-list">${refs.slice(start, end).map((ref) => `<li><code>${escapeHtml(ref.label || ref.id)}</code>${copyButton(ref.label || ref.id)}
      <dl class="stats-list">${renderSourceRows(ref, isEdge)}</dl></li>`).join("")}</ul>`
    : '<p class="details-empty">No source location is available for this derived object.</p>'}${names ? `<h4>Mapped names</h4><ul>${names}</ul>` : ""}${renderPager(count, page, "inspector")}`;
}

function renderSourceRows(ref, isEdge) {
  const rows = [["Source ID", ref.id]];
  if (ref.generatedFor) rows.push(["Generated for .names", ref.generatedFor]);
  if (isEdge) rows.push(["Target source ID", ref.targetId], ["Source input slot", ref.slot],
    ["Source edge polarity", ref.sourceInverted ? "Inverted" : "Positive"]);
  rows.push(["Position", ref.line ? `line ${ref.line}${ref.column ? `, column ${ref.column}` : ""}` : "Not supplied"],
    [isEdge ? "Normalized edge polarity" : "Alias polarity", ref.inverted ? "Inverted" : "Positive"]);
  return renderDefinitionRows(rows);
}

function renderTabs(target, entries, current) {
  return `<div class="aig-panel-tabs" role="tablist" aria-label="AIG ${target === "nav" ? "Navigator" : "Inspector"}">${entries.map(([id, label]) =>
    `<button type="button" role="tab" data-aig-${target}-tab="${id}" aria-selected="${current === id}"${current === id ? ' class="is-active"' : ""}>${label}</button>`).join("")}</div>`;
}

function renderSelect(name, label, entries, selected) {
  return `<label>${escapeHtml(label)} <select data-aig-filter="${name}">${entries.map(([value, text]) => `<option value="${value}"${value === selected ? " selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
}

function pageRange(count, requested) {
  const lastPage = Math.max(0, Math.ceil(count / AIG_PANEL_PAGE_SIZE) - 1);
  const page = Math.min(lastPage, Math.max(0, Math.floor(Number(requested) || 0)));
  return { page, start: page * AIG_PANEL_PAGE_SIZE, end: Math.min(count, (page + 1) * AIG_PANEL_PAGE_SIZE) };
}

function renderPager(count, page, target) {
  if (count <= AIG_PANEL_PAGE_SIZE) return "";
  const pages = Math.ceil(count / AIG_PANEL_PAGE_SIZE);
  return `<nav class="inspection-pager" aria-label="AIG ${target} pages" data-current-page="${page + 1}" data-page-count="${pages}"><button type="button" data-aig-page="${page - 1}" data-aig-page-target="${target}"${page === 0 ? " disabled" : ""}>Previous</button>
    <span>Page ${page + 1} / ${pages}</span><button type="button" data-aig-page="${page + 1}" data-aig-page-target="${target}"${page === pages - 1 ? " disabled" : ""}>Next</button></nav>`;
}

function nodeButton(node) {
  const label = aigObjectLabel(node);
  return `<button type="button" class="selection-link" data-aig-select="${escapeAttr(node.id)}" title="${escapeAttr(label)}">${escapeHtml(label)}</button>`;
}

function copyButton(text) {
  return `<button type="button" class="mini-button" data-aig-copy="${escapeAttr(text)}" aria-label="Copy full name or source ID">Copy</button>`;
}

function kindLabel(kind) {
  return { pi: "Input", po: "Output", and: "AND", constant: "Constant" }[kind] || kind;
}

function edgeLabel(edge, context) {
  return `${context.query.nodeById.get(edge.source).label} → ${context.query.nodeById.get(edge.target).label} [${edge.slot}]`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
