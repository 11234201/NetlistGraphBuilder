import { escapeAttr, escapeHtml } from "./html.js";

export function renderModuleChoices(select, modules) {
  select.innerHTML = "";
  for (const module of modules) {
    const option = document.createElement("option");
    option.value = module.name;
    option.textContent = module.displayName;
    select.append(option);
  }
}

export function renderCompareOutputChoices(select, left, right, outputName) {
  const rightOutputs = new Set(right.ports.filter(port => port.direction === "output").map(port => port.name));
  const outputs = left.ports.filter(port => port.direction === "output" && rightOutputs.has(port.name));
  select.innerHTML = `<option value="">Whole module</option>${outputs.map(port =>
    `<option value="${escapeAttr(port.name)}">${escapeHtml(port.displayName)}</option>`).join("")}`;
  select.value = outputName || "";
}
