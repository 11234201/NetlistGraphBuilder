import { writeProcessLogSafely } from "./processLog.js";
import { loadStoredCellConfigResult } from "../persistence/cell_config_storage.js";
import { loadSessionStateResult, saveSessionStateResult } from "../persistence/session_storage.js";
import { errorMessage, readErrorField } from "../foundation/log_details.js";

// Bootstrap and unload storage lifecycle; all state access stays in narrow callbacks.
export function restoreWorkbenchStorage({ windowTarget, logProcess, setCellConfig, getSessionSnapshot }) {
  function report(error, operation, message, context = {}) {
    writeProcessLogSafely(logProcess, "error", "persistence", `${message}: ${errorMessage(error)}`, {
      operation, code: readErrorField(error, "code") || `persistence.${operation}-failed`,
      fileCount: readErrorField(error, "fileCount"), moduleName: readErrorField(error, "moduleName"), ...context, error
    });
  }

  const cellConfig = loadStoredCellConfigResult();
  if (!cellConfig.ok) report(cellConfig.error, "load-cell-config", "Stored Cell Config could not be loaded; using empty config");
  setCellConfig(cellConfig.value);
  const session = loadSessionStateResult();
  if (!session.ok) report(session.error, "load-session", "Stored session could not be restored");

  windowTarget.addEventListener("beforeunload", () => {
    let result, snapshot;
    try {
      snapshot = getSessionSnapshot();
      if (!snapshot) return;
      result = saveSessionStateResult(snapshot);
    } catch (error) {
      result = { ok: false, error };
    }
    if (!result.ok) report(result.error, "save-session-on-unload", "Session could not be saved before closing", {
      fileCount: snapshot?.sourceFiles?.length, moduleName: snapshot?.moduleName
    });
  });
  return session.value;
}
