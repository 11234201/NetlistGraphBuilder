import { escapeAttr, escapeHtml } from "./html.js";

export function renderModuleHierarchyPanel(roots, currentModuleName) {
  if (!roots?.length) return '<div class="module-hierarchy-empty">No modules</div>';
  const truncated = roots.truncated
    ? '<div class="module-hierarchy-truncated">Hierarchy truncated at the configured display limit.</div>'
    : "";
  return `<ul class="module-hierarchy-tree">${roots.map((node) => renderNode(node, currentModuleName)).join("")}</ul>${truncated}`;
}

export function getModuleHierarchyTarget(event) {
  return event.target.closest?.("[data-module-hierarchy-name]")?.dataset.moduleHierarchyName || null;
}

function renderNode(node, currentModuleName) {
  const current = node.moduleName === currentModuleName;
  const label = node.instanceLabel
    ? `${node.instanceLabel} : ${node.moduleLabel}`
    : node.moduleLabel;
  const button = `<button type="button" class="module-hierarchy-link${current ? " is-current" : ""}" data-module-hierarchy-name="${escapeAttr(node.moduleName)}"${current ? ' aria-current="page"' : ""}>${escapeHtml(label)}${node.cycle ? ' <span class="module-hierarchy-cycle">cycle</span>' : ""}</button>`;
  const children = node.children.length
    ? `<ul>${node.children.map((child) => renderNode(child, currentModuleName)).join("")}</ul>`
    : "";
  const truncated = node.truncated
    ? '<span class="module-hierarchy-truncated">More instances omitted</span>'
    : "";
  return `<li>${button}${children}${truncated}</li>`;
}
