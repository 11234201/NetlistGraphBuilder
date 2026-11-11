import {
  CELL_CONFIG_STORAGE_KEY,
  createEmptyCellConfig,
  parseCellConfig,
  serializeCellConfig
} from "../infer/cellConfig.js";

export function loadStoredCellConfigResult(storage) {
  try {
    const target = arguments.length > 0 ? storage : globalThis.localStorage;
    if (!target || typeof target.getItem !== "function") throw new Error("Local storage is unavailable");
    const source = target.getItem(CELL_CONFIG_STORAGE_KEY);
    return { ok: true, value: source ? parseCellConfig(source) : createEmptyCellConfig() };
  } catch (error) {
    return { ok: false, value: createEmptyCellConfig(), error };
  }
}

export function loadStoredCellConfig(...args) {
  return loadStoredCellConfigResult(...args).value;
}

export function saveStoredCellConfig(bundle, storage) {
  const normalized = parseCellConfig(bundle);
  const target = arguments.length > 1 ? storage : globalThis.localStorage;
  if (!target || typeof target.setItem !== "function") throw new Error("Local storage is unavailable");
  target.setItem(CELL_CONFIG_STORAGE_KEY, serializeCellConfig(normalized));
  return normalized;
}
