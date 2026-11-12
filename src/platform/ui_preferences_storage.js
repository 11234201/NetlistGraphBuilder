export const UI_PREFERENCES_KEY = "netlistGraphBuilder.ui.v1";

export function createUiPreferencesStorage({ windowTarget = globalThis.window, storage } = {}) {
  const target = () => storage === undefined ? windowTarget?.localStorage : storage;
  return Object.freeze({
    read() {
      const selected = target();
      if (!selected?.getItem) throw new Error("UI preferences storage is unavailable");
      return selected.getItem(UI_PREFERENCES_KEY);
    },
    write(encoded) {
      const selected = target();
      if (!selected?.setItem) throw new Error("UI preferences storage is unavailable");
      selected.setItem(UI_PREFERENCES_KEY, encoded);
    }
  });
}
