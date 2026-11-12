import { WORKBENCH_PANEL_LIMITS, normalizeWorkbenchUiPreferences } from "../contracts/workbench_ui_preferences.js";

export function resolveWorkbenchShellLayout(viewportWidth, preferences, drawerPanel = null) {
  const width = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 1366;
  const prefs = normalizeWorkbenchUiPreferences(preferences);
  const navigatorMode = width >= 1600 ? "docked" : "drawer";
  const inspectorMode = width >= 1280 ? "docked" : "drawer";
  const panel = (name, mode, defaultOpen, defaultWidth) => ({
    mode,
    open: mode === "drawer" ? drawerPanel === name : (prefs[`${name}Open`] ?? defaultOpen),
    width: prefs[`${name}Width`] ?? defaultWidth
  });
  return {
    navigator: panel("navigator", navigatorMode, width >= 1600, 240),
    inspector: panel("inspector", inspectorMode, width >= 1280, width >= 1600 ? 336 : 320)
  };
}

export function normalizePanelWidth(panel, width) {
  const limits = WORKBENCH_PANEL_LIMITS[panel];
  if (!limits) throw new Error(`Unknown workbench panel: ${panel}`);
  return Number.isFinite(width)
    ? Math.min(limits.max, Math.max(limits.min, Math.round(width))) : limits.defaultWidth;
}

export function isEditableWorkbenchTarget(target) {
  return Boolean(target?.isContentEditable || target?.closest?.(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]'
  ));
}
