import { CELL_CONFIG_GATE_KINDS, canonicalCellType } from "../../infer/cellConfig.js";
import { inferCellKind, inferPinDirection } from "../../infer/defaultCellRules.js";

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

export function createInferredCellDefinition(summary) {
  const inferredKind = inferCellKind(summary.cellType).kind;
  const gateKind = inferredKind === "dff" ? "REGISTER" : inferredKind.toUpperCase();
  return {
    displayName: summary.displayName,
    gateKind: CELL_CONFIG_GATE_KINDS.includes(gateKind) ? gateKind : "BLACKBOX",
    pins: Object.fromEntries(summary.pins.map((pin) => [
      pin.canonicalName,
      inferPinDirection(pin.canonicalName, summary.cellType).direction
    ]))
  };
}
