import { restoreWorkbenchStorage } from "./workbench_storage.js";

// Compose stored preferences and the active document's startup in one place.
export function initializeWorkbench({ windowTarget, logProcess, setCellConfig, getSessionSnapshot,
  applySessionPreferences, renderLayoutProviderOptions, initializeDomain, initializeApplication, updateCalibrationControls }) {
  const restoredSession = restoreWorkbenchStorage({ windowTarget, logProcess, setCellConfig, getSessionSnapshot });
  applySessionPreferences(restoredSession);
  renderLayoutProviderOptions();
  const ready = initializeDomain(() => initializeApplication(restoredSession));
  updateCalibrationControls();
  return Promise.resolve(ready);
}
