import {
  CELL_CONFIG_STORAGE_KEY,
  createEmptyCellConfig,
  parseCellConfig,
  serializeCellConfig
} from "../infer/cellConfig.js";

export function loadStoredCellConfig(storage) {
  try {
    const target = arguments.length > 0 ? storage : globalThis.localStorage;
    const source = target?.getItem(CELL_CONFIG_STORAGE_KEY);
    return source ? parseCellConfig(source) : createEmptyCellConfig();
  } catch {
    return createEmptyCellConfig();
  }
}

export function saveStoredCellConfig(bundle, storage) {
  const normalized = parseCellConfig(bundle);
  const target = arguments.length > 1 ? storage : globalThis.localStorage;
  target?.setItem(CELL_CONFIG_STORAGE_KEY, serializeCellConfig(normalized));
  return normalized;
}
