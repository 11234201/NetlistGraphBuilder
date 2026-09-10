import {
  CELL_CONFIG_STORAGE_KEY,
  createEmptyCellConfig,
  parseCellConfig,
  serializeCellConfig
} from "../infer/cellConfig.js";

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
