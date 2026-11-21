import { commandFailure } from "./remote_file_import.js";

export function createRemoteCellConfigImport({ useCases, read, write, refresh }) {
  return async (file, options) => {
    const prepared = useCases.prepareImport(read(), file.text);
    if (prepared.conflicts.length && options["on-conflict"] !== "replace") {
      throw commandFailure("CELL_CONFIG_CONFLICT", "Cell definitions already exist", { candidates:prepared.conflicts });
    }
    write(useCases.commitImport(prepared));
    await refresh();
  };
}
