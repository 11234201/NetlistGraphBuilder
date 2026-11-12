import { decodeUiPreferences, encodeUiPreferences } from "../persistence/ui_preferences_codec.js";
import { createUiPreferencesStorage } from "../platform/ui_preferences_storage.js";

export function createUiPreferencesStore({ windowTarget, storage, onError = () => {} } = {}) {
  const adapter = createUiPreferencesStorage({ windowTarget, storage });
  const reported = new Set();
  const report = (operation, error) => {
    if (reported.has(operation)) return;
    reported.add(operation);
    try { onError(error, { operation }); } catch { /* Optional diagnostics cannot block the workbench. */ }
  };
  return Object.freeze({
    load() {
      try { return decodeUiPreferences(adapter.read()); }
      catch (error) { report("load", error); return decodeUiPreferences(null); }
    },
    save(value) {
      try { adapter.write(encodeUiPreferences(value)); return true; }
      catch (error) { report("save", error); return false; }
    }
  });
}
