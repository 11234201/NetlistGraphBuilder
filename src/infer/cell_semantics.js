import { inferCellKind, inferPinDirection, ensureFallbackCellPinDirections } from "./defaultCellRules.js";
import { resolveCellConfigDefinition, toInternalGateKind } from "./cellConfig.js";
import { findLibertyCell } from "./liberty_model.js";
import { LIBERTY_LIMITS } from "../contracts/liberty.js";

const own = (object, key) => Object.hasOwn(object || {}, key) ? object[key] : undefined;
const known = (direction) => ["input", "output", "inout"].includes(direction);

export function resolveCellSemantics(cell, { moduleDefinition = null, cellConfig = null, cellLibrary = null, overrides = {} } = {}) {
  const configured = moduleDefinition ? null : resolveCellConfigDefinition(cellConfig, cell.type);
  const libraryCell = moduleDefinition ? null : findLibertyCell(cellLibrary, cell.type);
  const kind = moduleDefinition ? { kind: "module", source: "module-definition" }
    : configured ? { kind: toInternalGateKind(configured.gateKind), source: "user-config" }
      : libraryCell ? { kind: libraryCell.logic.kind, source: "library" } : inferCellKind(cell.type);
  const modulePorts = new Map((moduleDefinition?.ports || []).map((port) => [port.name, port]));
  const diagnostics = [];
  const warn = (code, message, pin = null) => {
    if (diagnostics.length < LIBERTY_LIMITS.maxDiagnostics) diagnostics.push({ code, severity: "warning", message,
      instance: cell.instance, cellType: cell.type, pin, sourceName: cellLibrary.sourceName });
  };
  if (cellLibrary && !moduleDefinition && !libraryCell) {
    warn("library-missing-cell", `${cell.type} is absent from ${cellLibrary.sourceName}; configured or naming rules apply`);
  }
  if (moduleDefinition && findLibertyCell(cellLibrary, cell.type)) {
    warn("library-module-conflict", `${cell.type} has a real Verilog module definition; module identity and declared ports take precedence`);
  }
  if (configured && libraryCell && kind.kind !== libraryCell.logic.kind) {
    warn("library-kind-conflict", `${cell.type}: user-config ${kind.kind} takes precedence over library ${libraryCell.logic.kind}`);
  }
  let pinDirections = {};
  for (const pin of cell.pins || []) {
    const displayName = pin.pinDisplayName || pin.pin;
    const modulePort = modulePorts.get(pin.pin);
    const override = own(overrides, pin.pin) ?? own(overrides, displayName);
    const configuredDirection = own(configured?.pins, pin.pin) ?? own(configured?.pins, displayName);
    const libraryPin = own(libraryCell?.pins, pin.pin);
    if (libraryCell && !libraryPin && !own(libraryCell.powerPins, pin.pin)) {
      warn("library-missing-pin", `${cell.instance}.${displayName} is absent from library cell ${cell.type}`, pin.pin);
    }
    let direction;
    if (known(modulePort?.direction)) direction = { direction: modulePort.direction, source: "module-definition", moduleName: moduleDefinition.name };
    else if (known(override) || override === "unknown") direction = { direction: override, source: "override" };
    else if (configuredDirection) direction = { direction: configuredDirection, source: "user-config" };
    else if (libraryPin && known(libraryPin.direction)) {
      direction = { direction: libraryPin.direction, source: "library", libraryName: libraryCell.libraryName,
        sourceName: libraryCell.sourceName, span: libraryPin.span };
      if (libraryCell.logic.selectPin === pin.pin) direction.role = "select";
      else if (libraryPin.clock) direction.role = "clock";
    } else if (libraryPin?.direction === "internal") {
      direction = { direction: "unknown", source: "library", role: "internal", libraryName: libraryCell.libraryName };
      warn("library-internal-pin", `${cell.instance}.${displayName} is an internal library pin; excluded from data connectivity`, pin.pin);
    } else if (own(libraryCell?.powerPins, pin.pin)) {
      direction = { direction: "unknown", source: "library", role: "power", libraryName: libraryCell.libraryName };
    } else direction = inferPinDirection(pin.pin, cell.type);
    if (libraryPin && known(libraryPin.direction) && ["override", "user-config"].includes(direction.source) && direction.direction !== libraryPin.direction) {
      warn("library-direction-conflict", `${cell.instance}.${displayName}: ${direction.source} ${direction.direction} takes precedence over library ${libraryPin.direction}`, pin.pin);
    }
    Object.defineProperty(pinDirections, displayName, { value: direction, enumerable: true, configurable: true, writable: true });
  }
  if (kind.source === "unknown") {
    const inferred = ensureFallbackCellPinDirections(pinDirections);
    for (const [pin, direction] of Object.entries(pinDirections)) {
      if (["override", "user-config"].includes(direction.source)) inferred[pin] = direction;
    }
    pinDirections = inferred;
  }
  return { kind, pinDirections, libraryCell, diagnostics };
}
