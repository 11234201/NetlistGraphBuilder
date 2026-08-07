export const CELL_CONFIG_KIND = "netlist-cell-config";
export const CELL_CONFIG_VERSION = 1;
export const CELL_CONFIG_STORAGE_KEY = "netlistGraphBuilder.cellConfig.v1";
export const CELL_CONFIG_GATE_KINDS = Object.freeze(["AND", "OR", "MUX", "INV", "NAND", "NOR", "XOR", "XNOR", "BUF", "REGISTER", "BLACKBOX"]);
export const CELL_CONFIG_PIN_DIRECTIONS = Object.freeze(["input", "output", "inout", "unknown"]);

const GATE_KIND_SET = new Set(CELL_CONFIG_GATE_KINDS);
const DIRECTION_SET = new Set(CELL_CONFIG_PIN_DIRECTIONS);
const TOP_LEVEL_KEYS = new Set(["kind", "version", "cells"]);
const CELL_KEYS = new Set(["displayName", "gateKind", "pins"]);

export function createEmptyCellConfig() {
  return { kind: CELL_CONFIG_KIND, version: CELL_CONFIG_VERSION, cells: {} };
}

export function parseCellConfig(value) {
  const input = typeof value === "string" ? JSON.parse(value) : value;
  assertPlainObject(input, "Cell Config");
  rejectUnknownKeys(input, TOP_LEVEL_KEYS, "Cell Config");
  if (input.kind !== CELL_CONFIG_KIND) throw new Error(`Cell Config kind must be ${CELL_CONFIG_KIND}`);
  if (input.version !== CELL_CONFIG_VERSION) throw new Error(`Unsupported Cell Config version: ${input.version}`);
  assertPlainObject(input.cells, "Cell Config cells");
  const cells = {};
  for (const rawType of Object.keys(input.cells).sort()) {
    const type = canonicalCellType(rawType);
    if (!type) throw new Error("Cell Config cell type must not be empty");
    if (cells[type]) throw new Error(`Duplicate canonical cell type: ${type}`);
    const definition = input.cells[rawType];
    assertPlainObject(definition, `Cell Config ${rawType}`);
    rejectUnknownKeys(definition, CELL_KEYS, `Cell Config ${rawType}`);
    const gateKind = String(definition.gateKind || "").toUpperCase();
    if (!GATE_KIND_SET.has(gateKind)) throw new Error(`Unsupported gate kind for ${rawType}: ${definition.gateKind}`);
    assertPlainObject(definition.pins, `Cell Config ${rawType}.pins`);
    const pins = {};
    for (const rawPin of Object.keys(definition.pins).sort()) {
      const pin = canonicalPinName(rawPin);
      const direction = definition.pins[rawPin];
      if (!DIRECTION_SET.has(direction)) throw new Error(`Unsupported pin direction for ${rawType}.${rawPin}: ${direction}`);
      if (Object.hasOwn(pins, pin)) throw new Error(`Duplicate canonical pin for ${rawType}: ${pin}`);
      pins[pin] = direction;
    }
    cells[type] = { displayName: String(definition.displayName || rawType), gateKind, pins };
  }
  return { kind: CELL_CONFIG_KIND, version: CELL_CONFIG_VERSION, cells };
}

export function serializeCellConfig(bundle, spacing = 2) {
  return JSON.stringify(parseCellConfig(bundle), null, spacing);
}

export function resolveCellConfigDefinition(bundle, cellType) {
  return bundle?.cells?.[canonicalCellType(cellType)] || null;
}

export function setCellConfigDefinition(bundle, cellType, definition) {
  const type = canonicalCellType(cellType);
  return parseCellConfig({
    ...parseCellConfig(bundle),
    cells: { ...parseCellConfig(bundle).cells, [type]: definition }
  });
}

export function removeCellConfigDefinition(bundle, cellType) {
  const normalized = parseCellConfig(bundle);
  const cells = { ...normalized.cells };
  delete cells[canonicalCellType(cellType)];
  return { ...normalized, cells };
}

export function mergeCellConfigs(current, incoming) {
  const left = parseCellConfig(current);
  const right = parseCellConfig(incoming);
  const conflicts = Object.keys(right.cells).filter((type) => Object.hasOwn(left.cells, type)).sort();
  return {
    bundle: parseCellConfig({ ...left, cells: { ...left.cells, ...right.cells } }),
    conflicts
  };
}

export function toInternalGateKind(gateKind) {
  return gateKind === "REGISTER" ? "dff" : String(gateKind || "BLACKBOX").toLowerCase();
}

export function loadStoredCellConfig(storage = globalThis.localStorage) {
  try {
    const source = storage?.getItem(CELL_CONFIG_STORAGE_KEY);
    return source ? parseCellConfig(source) : createEmptyCellConfig();
  } catch {
    return createEmptyCellConfig();
  }
}

export function saveStoredCellConfig(bundle, storage = globalThis.localStorage) {
  const normalized = parseCellConfig(bundle);
  storage?.setItem(CELL_CONFIG_STORAGE_KEY, serializeCellConfig(normalized));
  return normalized;
}

export function canonicalCellType(value) {
  return String(value || "").trim().replace(/^\\/, "");
}

export function canonicalPinName(value) {
  return String(value || "").trim().replace(/^\\/, "");
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function rejectUnknownKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} contains unknown field: ${unknown[0]}`);
}
