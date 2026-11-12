import { normalizeWorkbenchUiPreferences } from "../contracts/workbench_ui_preferences.js";

export function decodeUiPreferences(encoded) {
  if (encoded == null) return normalizeWorkbenchUiPreferences(null);
  const value = typeof encoded === "string" ? JSON.parse(encoded) : encoded;
  if (!value || value.version !== 1 || Array.isArray(value)) {
    throw new Error("Unsupported UI preferences version");
  }
  return normalizeWorkbenchUiPreferences(value);
}

export function encodeUiPreferences(value) {
  return JSON.stringify({ version: 1, ...normalizeWorkbenchUiPreferences(value) });
}
