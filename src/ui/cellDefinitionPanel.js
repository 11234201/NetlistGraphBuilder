import {
  CELL_CONFIG_GATE_KINDS,
  CELL_CONFIG_PIN_DIRECTIONS,
  canonicalCellType
} from "../infer/cellConfig.js";
import { escapeAttr, escapeHtml } from "./html.js";

export function collectCellTypeSummary(design, cellType) {
  const type = canonicalCellType(cellType);
  const pins = new Map();
  let instanceCount = 0;
  for (const module of design?.modules || []) {
    for (const cell of module.cells || []) {
      if (canonicalCellType(cell.type) !== type) continue;
      instanceCount += 1;
      for (const pin of cell.pins || []) {
        const name = pin.pinDisplayName || pin.pin;
        const current = pins.get(name) || { name, canonicalName: pin.pin, count: 0 };
        current.count += 1;
        pins.set(name, current);
      }
    }
  }
  return {
    cellType: type,
    displayName: cellType,
    instanceCount,
    pins: [...pins.values()].sort((left, right) => left.name.localeCompare(right.name))
  };
}

export function renderCellDefinitionEditor(summary, definition = null) {
  const gateKind = definition?.gateKind || "BLACKBOX";
  const rows = summary.pins.map((pin) => {
    const direction = definition?.pins?.[pin.canonicalName] || "unknown";
    return `<label class="cell-definition-pin"><span>${escapeHtml(pin.name)} <small>${pin.count} instance(s)</small></span><select data-cell-config-pin="${escapeAttr(pin.canonicalName)}">${CELL_CONFIG_PIN_DIRECTIONS.map((item) => `<option value="${item}"${item === direction ? " selected" : ""}>${item}</option>`).join("")}</select></label>`;
  }).join("");
  return `<input type="hidden" name="cellType" value="${escapeAttr(summary.cellType)}">
    <dl class="stats-list"><dt>Cell type</dt><dd>${escapeHtml(summary.displayName)}</dd><dt>Instances</dt><dd>${summary.instanceCount}</dd></dl>
    <label class="cell-definition-field"><span>Gate kind</span><select id="cellDefinitionGateKind">${CELL_CONFIG_GATE_KINDS.map((item) => `<option value="${item}"${item === gateKind ? " selected" : ""}>${item}</option>`).join("")}</select></label>
    <div class="cell-definition-pins"><h3>Pin directions</h3>${rows || "<p>No connected pins</p>"}</div>`;
}

export function readCellDefinitionEditor(form, summary) {
  const pins = {};
  for (const select of form.querySelectorAll("[data-cell-config-pin]")) {
    pins[select.dataset.cellConfigPin] = select.value;
  }
  return {
    displayName: summary.displayName,
    gateKind: form.querySelector("#cellDefinitionGateKind")?.value || "BLACKBOX",
    pins
  };
}
