import { escapeAttr, escapeHtml } from "./html.js";

export function renderModuleHierarchyPanel(roots, currentModuleName, options = {}) {
  if (!roots?.length) return `<div class="module-hierarchy-empty">${escapeHtml(options.emptyMessage || "No modules")}</div>`;
  const truncated = roots.truncated
    ? '<div class="module-hierarchy-truncated">Hierarchy truncated at the configured display limit.</div>'
    : "";
  return `<ul class="module-hierarchy-tree">${roots.map((node) => renderNode(node, currentModuleName, options.currentOccurrenceContext)).join("")}</ul>${truncated}`;
}

export function filterModuleHierarchy(roots, query) {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
  if (!normalizedQuery || !roots?.length) return roots;
  const filtered = roots.map((node) => filterNode(node, normalizedQuery)).filter(Boolean);
  Object.defineProperty(filtered, "truncated", { value: Boolean(roots.truncated), enumerable: false });
  return Object.freeze(filtered);
}

export function getModuleHierarchyTarget(event) {
  return event.target.closest?.("[data-module-hierarchy-name]")?.dataset.moduleHierarchyName || null;
}

function renderNode(node, currentModuleName, currentOccurrenceContext) {
  const current = node.moduleName === currentModuleName && matchesOccurrence(node, currentOccurrenceContext);
  const label = node.instanceLabel
    ? `${node.instanceLabel} : ${node.moduleLabel}`
    : node.moduleLabel;
  const canonicalPath = node.canonicalOccurrencePath?.join("/") || "";
  const rootModuleName = node.rootModuleName || node.moduleName;
  const pathLabel = [rootModuleName, ...node.canonicalOccurrencePath || []].join(" / ");
  const button = `<button type="button" class="module-hierarchy-link${current ? " is-current" : ""}" data-module-hierarchy-name="${escapeAttr(node.moduleName)}" data-module-hierarchy-id="${escapeAttr(node.id)}" data-module-hierarchy-path="${escapeAttr(canonicalPath)}" data-module-hierarchy-root="${escapeAttr(rootModuleName)}" title="${escapeAttr(pathLabel)}"${current ? ' aria-current="page"' : ""}>${escapeHtml(label)}${node.cycle ? ' <span class="module-hierarchy-cycle">cycle</span>' : ""}</button>`;
  const children = node.children.length
    ? `<ul>${node.children.map((child) => renderNode(child, currentModuleName, currentOccurrenceContext)).join("")}</ul>`
    : "";
  const truncated = node.truncated
    ? '<span class="module-hierarchy-truncated">More instances omitted</span>'
    : "";
  return `<li>${button}${children}${truncated}</li>`;
}

function matchesOccurrence(node, context) {
  if (!context) return true;
  const path = context.occurrencePath || [];
  const nodePath = node.canonicalOccurrencePath || [];
  return (context.rootModuleName || null) === (node.rootModuleName || node.moduleName) &&
    path.length === nodePath.length && path.every((segment, index) => segment === nodePath[index]);
}

function filterNode(node, query) {
  const matchesSelf = [node.moduleName, node.moduleLabel, node.instanceName, node.instanceLabel]
    .some((value) => String(value || "").toLocaleLowerCase().includes(query));
  const matchingChildren = node.children.map((child) => filterNode(child, query)).filter(Boolean);
  if (!matchesSelf && matchingChildren.length === 0) return null;
  return Object.freeze({
    ...node,
    children: matchesSelf ? node.children : Object.freeze(matchingChildren)
  });
}
