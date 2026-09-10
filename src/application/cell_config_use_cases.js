import {
  createEmptyCellConfig,
  mergeCellConfigs,
  parseCellConfig,
  removeCellConfigDefinition,
  setCellConfigDefinition
} from "../infer/cellConfig.js";

export function createCellConfigUseCases({ save }) {
  if (typeof save !== "function") throw new Error("Cell Config use cases require save()");
  const commit = (bundle) => save(parseCellConfig(bundle));
  return Object.freeze({
    set(current, cellType, definition) {
      return commit(setCellConfigDefinition(current, cellType, definition));
    },
    remove(current, cellType) {
      return commit(removeCellConfigDefinition(current, cellType));
    },
    prepareImport(current, source) {
      const incoming = parseCellConfig(source);
      const merged = mergeCellConfigs(current, incoming);
      return Object.freeze({ incoming, bundle: merged.bundle, conflicts: Object.freeze([...merged.conflicts]) });
    },
    commitImport(prepared) {
      if (!prepared?.bundle) throw new Error("Prepared Cell Config import is required");
      return commit(prepared.bundle);
    },
    reset() {
      return commit(createEmptyCellConfig());
    }
  });
}
