import { escapeHtml, renderDefinitionRows } from "./html.js";

export function groupAttributesByCategory(attributes = []) {
  const groups = new Map();
  for (const entry of attributes || []) {
    if (!entry || !entry.key) continue;
    const category = entry.category || "attr";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push([entry.key, entry.value ?? entry.rawValue ?? ""]);
  }
  return groups;
}

export function renderAttributeGroups(attributes, emptyText = "No attributes.") {
  const groups = groupAttributesByCategory(attributes);
  if (groups.size === 0) {
    return `<p class="details-empty">${escapeHtml(emptyText)}</p>`;
  }
  return [...groups.entries()].map(([category, rows]) => `<div class="attributes-group">
    <h4><code>${escapeHtml(category)}</code></h4>
    <dl class="stats-list attribute-list">${renderDefinitionRows(rows)}</dl>
  </div>`).join("");
}

export function renderModuleAttributesSummary({
  compareActive = false,
  currentModule = null,
  graph = null,
  leftModule = null,
  rightModule = null,
  leftGraph = null,
  rightGraph = null
} = {}) {
  if (compareActive) {
    const sides = [
      { label: "A", module: leftModule, graph: leftGraph },
      { label: "B", module: rightModule, graph: rightGraph }
    ];
    const blocks = sides.map(({ label, module, graph: sideGraph }) => {
      const title = module?.displayName || sideGraph?.moduleDisplayName || module?.name || sideGraph?.moduleName || label;
      const attrs = module?.attributes || sideGraph?.moduleAttributes || [];
      return `<div class="module-attributes-side">
        <h4>${escapeHtml(label)} · ${escapeHtml(title)}</h4>
        ${renderAttributeGroups(attrs, "No module attributes.")}
      </div>`;
    }).join("");
    return `<h3>Module attributes</h3>${blocks}`;
  }
  if (!currentModule && !graph) return "";
  const attrs = currentModule?.attributes || graph?.moduleAttributes || [];
  return `<h3>Module attributes</h3>${renderAttributeGroups(attrs, "No module attributes.")}`;
}

export function renderObjectAttributesSection(inspection) {
  if (!inspection) return "";
  const titleMap = {
    cell: "Instance attributes",
    input: "Port attributes",
    output: "Port attributes",
    net: "Net attributes"
  };
  const blocks = [];
  const heading = titleMap[inspection.kind] || "Attributes";
  blocks.push(`<section class="connection-section attributes-section">
    <h3>${escapeHtml(heading)}</h3>
    ${renderAttributeGroups(inspection.attributes, "No attributes on this object.")}
  </section>`);

  if (inspection.referencedModuleName) {
    const moduleLabel = inspection.referencedModuleDisplayName || inspection.referencedModuleName;
    blocks.push(`<section class="connection-section attributes-section">
      <h3>Module attributes <span class="connection-scope-label">${escapeHtml(moduleLabel)}</span></h3>
      ${renderAttributeGroups(inspection.moduleAttributes, "No module attributes on referenced module.")}
    </section>`);
  }

  if (inspection.definitionRows?.length) {
    blocks.push(`<section class="connection-section attributes-section">
      <h3>Definition &amp; inference</h3>
      <dl class="stats-list">${renderDefinitionRows(inspection.definitionRows)}</dl>
    </section>`);
  }

  return `<section data-inspector-section="attributes" data-object-attributes aria-label="Attributes">${blocks.join("")}</section>`;
}
