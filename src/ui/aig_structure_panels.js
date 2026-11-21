import { escapeAttr as attr, escapeHtml as html, renderDefinitionRows } from "./html.js";
import { aigObjectLabel } from "./aig_object_label.js";

const PAGE_SIZE = 100;
const names = { xor: "XOR2", xnor: "XNOR2", mux: "MUX2" };
const reasonNames = { "work-limit": "work budget", "cut-limit": "cuts per node", "cut-cache-limit": "cut cache",
  "result-limit": "result count", "reach-node-limit": "downstream search size", "witness-limit": "stored paths", "detail-node-limit": "path union size", "block-node-limit": "block size" };
function label(workspace, id) {
  const object = workspace.query.nodeById.get(id);
  return object ? aigObjectLabel(object) : id;
}
const node = (workspace, id, text = label(workspace, id)) => `<button type="button" class="selection-link" data-aig-select="${attr(id)}">${html(text)}</button>`;
function formulaName(workspace, id) {
  const signal = workspace.query.nodeById.get(id);
  const name = (signal?.kind === "pi" && signal.primaryNameMapping?.name) || signal?.label || id;
  if (signal?.kind !== "pi" && /^\d+$/.test(name)) return name;
  return /^[\p{L}_$][\p{L}\p{N}_$./\[\]-]*$/u.test(name) ? name : JSON.stringify(name);
}
const action = (id, text) => `<button type="button" class="mini-button" data-aig-analysis-action="${id}">${text}</button>`;
const heading = (workspace, result) => result.category === "block" ? `${names[result.kind]} · ${label(workspace, result.rootId)}`
  : `${label(workspace, result.stemId)} → ${label(workspace, result.mergeId)}`;

export function revealAigStructureSelection(query, panel, id) {
  const result = query?.get(id);
  if (!result) return panel;
  let type = panel.type, index = query.list(result.category, type).findIndex((item) => item.id === id);
  if (index < 0) { type = "all"; index = query.list(result.category, type).findIndex((item) => item.id === id); }
  return { ...panel, selectedId: id, category: result.category, type, page: Math.floor(Math.max(0, index) / PAGE_SIZE), detailPage: 0 };
}

function range(count, requested) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE)), page = Math.min(pages - 1, Math.max(0, Math.floor(Number(requested) || 0)));
  return { page, pages, start: page * PAGE_SIZE, end: (page + 1) * PAGE_SIZE };
}
function pager(count, requested, detail = false) {
  if (count <= PAGE_SIZE) return "";
  const { page, pages } = range(count, requested), field = detail ? "detail-page" : "page";
  const target = detail ? "analysis-details" : "analysis-results";
  return `<nav class="inspection-pager" aria-label="Analysis pages" data-current-page="${page + 1}" data-page-count="${pages}"><button type="button" data-aig-page-target="${target}" data-aig-analysis-${field}="${page - 1}"${page ? "" : " disabled"}>Previous</button>
    <span>${page + 1} / ${pages}</span><button type="button" data-aig-page-target="${target}" data-aig-analysis-${field}="${page + 1}"${page + 1 < pages ? "" : " disabled"}>Next</button></nav>`;
}
function limits(data) { return data?.reasons?.length ? `<p class="details-empty">Reached: ${html(data.reasons.map((key) => reasonNames[key] || key).join(", "))}. Results are partial.</p>` : ""; }
function resultLink(workspace, result, selectedId) {
  return `<button type="button" class="aig-analysis-result${result.id === selectedId ? " is-current" : ""}" data-aig-analysis-select="${attr(result.id)}"${result.id === selectedId ? ' aria-current="true"' : ""}>
    <strong>${html(heading(workspace, result))}</strong><small>${result.category === "block"
      ? `${result.nodeIds.length} AND nodes`
      : `Path A: ${result.paths[0].edgeIds.length} edges · Path B: ${result.paths[1].edgeIds.length} edges`}</small></button>`;
}

export function renderAigStructureNavigator(workspace, view = {}) {
  const category = view.category === "block" ? "block" : "reconvergence", results = view.query?.list(category, view.type) || [];
  const status = view.status || "idle", block = view.data?.blocks, recon = view.data?.reconvergence;
  const { start, end } = range(results.length, view.page);
  return `<div class="aig-analysis-status" data-aig-analysis-status="${attr(status)}"><strong>${html({ idle: "Waiting to analyze", running: "Analyzing…", complete: "Analysis complete", partial: "Partial results", cancelled: "Analysis cancelled", error: "Analysis unavailable" }[status] || status)}</strong>
    ${status === "running" ? action("cancel", "Cancel") : action("run", "Analyze again")}</div>
    ${view.error ? `<p class="details-empty">${html(view.error)}</p>` : ""}
    <div class="aig-panel-tabs" role="tablist" aria-label="Structure analysis">${[["reconvergence", `Reconvergence (${recon?.results.length ?? "—"})`], ["block", `Blocks (${block?.results.length ?? "—"})`]].map(([id, text]) =>
      `<button type="button" role="tab" data-aig-analysis-category="${id}" aria-selected="${category === id}"${category === id ? ' class="is-active"' : ""}>${text}</button>`).join("")}</div>
    <p class="details-empty">${category === "block" ? "Blocks are named at the positive root. Select a block to see what each outgoing edge carries." : "Structural paths; input activation is not evaluated."}</p>
    ${category === "block" ? `<label class="aig-analysis-filter">Root type <select data-aig-filter="structureType">${[["all", "All types"], ...Object.entries(names)].map(([id, text]) => `<option value="${id}"${view.type === id ? " selected" : ""}>${text}</option>`).join("")}</select></label>
      <p>${results.length} candidates · ${view.query?.uniqueRoots || 0} distinct roots overall</p>` : `<p>${results.length} stem / merge pairs</p>`}
    ${limits(category === "block" ? block : recon)}
    <ul class="aig-analysis-list">${results.slice(start, end).map((result) => `<li>${resultLink(workspace, result, view.selectedId)}</li>`).join("")}</ul>
    ${!results.length && ["complete", "partial"].includes(status) ? '<p class="details-empty">No results in the current analysis.</p>' : ""}${pager(results.length, view.page)}`;
}

export function renderAigStructureInspector(workspace, view) {
  const selected = view?.query?.get(view.selectedId);
  if (!selected) return null;
  return `<section class="aig-structure-details" data-aig-analysis-inspected="${attr(selected.id)}">
    <header class="inspector-object-header"><h3>${html(heading(workspace, selected))}</h3><div class="aig-analysis-actions">${action("locate", "Locate")}${action("clear", "Clear highlight")}</div></header>
    ${selected.category === "block" ? blockDetails(workspace, selected, view) : reconDetails(workspace, selected, view)}</section>`;
}
function blockDetails(workspace, result, view) {
  const signalIds = new Set([result.rootId, ...result.inputIds]);
  const formulaNames = new Set([...signalIds].map((id) => formulaName(workspace, id)));
  const ambiguous = formulaNames.size < signalIds.size;
  const signalLabel = (id) => ambiguous ? id : formulaName(workspace, id);
  const pinLabel = (id) => ambiguous ? id + " · " + formulaName(workspace, id) : signalLabel(id);
  const root = signalLabel(result.rootId);
  const positive = view.query.functionAtUse(result), negative = view.query.functionAtUse(result, true);
  const formula = view.query.formula(positive, signalLabel);
  return `<h4>Function at the positive root</h4><p class="aig-analysis-formula">${html(root)} = ${html(formula)}</p>
    <dl class="stats-list">${renderDefinitionRows([["Root type", names[positive.kind]],
      ["AND members", result.nodeIds.length], ["Boundary signals", result.boundaryIds.length], ["Effective inputs", result.inputIds.length]])}</dl>
    <h4>Input mapping at the positive root</h4><ul class="aig-pin-list">${Object.entries(positive.pins).map(([role, pin]) => `<li><code>${html(role.toUpperCase())}</code> ${pin.inverted ? "¬" : ""}${node(workspace, pin.nodeId, pinLabel(pin.nodeId))} <small>${pin.inverted ? "inverted" : "positive"}</small></li>`).join("")}</ul>
    ${result.kind === "mux" ? '<p class="details-empty">D0 and D1 show the values selected at the root. An inverted outgoing edge complements both data values and preserves S.</p>' : ""}
    ${renderBlockUses(workspace, view.query.blockUses(result, (workspace.displayAnalysis || workspace.document.analysis).outgoing, workspace.visibleEdgeIds), view.detailPage, {
      positive: `${names[positive.kind]} · ${html(formula)}`,
      inverted: `${names[negative.kind]} · ${html(view.query.formula(negative, signalLabel))}`
    })}
    ${related(workspace, view, result, "reconvergence")}
    ${related(workspace, view, result, "block")}`;
}
function renderBlockUses(workspace, { rootEdges, taps }, page, formulas) {
  const count = rootEdges.length + taps.length, { start, end } = range(count, page);
  const rows = (ids, rootUse) => ids.map((id) => {
    const edge = workspace.query.edgeById.get(id), phase = edge.inverted ? "inverted" : "positive";
    const port = workspace.query.nodeById.get(edge.target).kind === "po" ? "output port" : `input ${edge.slot}`;
    const source = rootUse ? "" : `${node(workspace, edge.source)} → `;
    return `<li>${source}${node(workspace, edge.target)} · ${port} · ${phase} edge${rootUse ? `<br><code>${formulas[phase]}</code>` : ""}</li>`;
  }).join("");
  const rootRows = rows(rootEdges.slice(start, end), true);
  const tapRows = rows(taps.slice(Math.max(0, start - rootEdges.length), Math.max(0, end - rootEdges.length)), false);
  return `${rootRows || !rootEdges.length ? `<h4>Root output uses (${rootEdges.length})</h4><ul class="aig-source-list">${rootRows}</ul>` : ""}
    ${tapRows ? `<h4>External uses of internal signals (${taps.length})</h4><ul class="aig-source-list">${tapRows}</ul>` : ""}
    ${pager(count, page, true)}`;
}
function reconDetails(workspace, result, view) {
  const detail = view.detail?.id === result.id ? view.detail : null;
  const rows = result.paths.flatMap((path, index) => path.nodeIds.map((id, step) => ({ id, step, branch: index ? "B" : "A", edgeId: step ? path.edgeIds[step - 1] : null })));
  const { start, end } = range(rows.length, view.detailPage);
  return `<dl class="stats-list">${renderDefinitionRows([["Stem", label(workspace, result.stemId)], ["Merge", label(workspace, result.mergeId)],
    ["Path A / B AND depth", result.paths.map((path) => path.andDepth).join(" / ")], ["Path union", detail ? `${detail.nodeIds.length} nodes · ${detail.edgeIds.length} edges (${detail.status})` : view.detailStatus === "running" ? "Computing…" : "Witness paths only"]])}</dl>
    <p class="aig-analysis-legend"><span class="aig-path-a">● Path A</span> <span class="aig-path-b">● Path B</span> · dashed = inverted</p>
    <p class="details-empty">The two paths share only their stem and merge. Other paths in the union are teal; nested pairs remain separate results.</p>
    ${limits(detail)}${view.detailError ? `<p class="details-empty">${html(view.detailError)}</p>` : ""}
    <h4>Witness paths</h4><ol class="aig-witness-list">${rows.slice(start, end).map(({ id, step, branch, edgeId }) => `<li><span class="aig-path-${branch.toLowerCase()}">${branch} · ${step}</span> ${edgeId ? workspace.query.edgeById.get(edgeId)?.inverted ? "⇢ ¬" : "→" : ""}${node(workspace, id)}</li>`).join("")}</ol>${pager(rows.length, view.detailPage, true)}
    ${related(workspace, view, result, "block", detail)}`;
}
function related(workspace, view, subject, category, detail) {
  const results = view.query?.relatedTo(subject, category, detail) || [];
  if (!results.length) return "";
  return `<h4>${category === "block" ? "Related blocks" : "Related reconvergence"} (${results.length})</h4><ul class="aig-analysis-list">${results.slice(0, 20).map((result) => `<li>${resultLink(workspace, result, view.selectedId)}</li>`).join("")}</ul>${results.length > 20 ? '<p class="details-empty">First 20 shown. Use Navigator for the full list.</p>' : ""}`;
}
export function renderAigStructureMembership(workspace, object, view) {
  return related(workspace, view || {}, object, "block") + related(workspace, view || {}, object, "reconvergence");
}
