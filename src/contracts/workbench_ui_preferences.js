export const WORKBENCH_PANEL_LIMITS = Object.freeze({
  navigator: Object.freeze({ min: 220, max: 360, defaultWidth: 240 }),
  inspector: Object.freeze({ min: 320, max: 560, defaultWidth: 336 })
});

export function normalizeWorkbenchUiPreferences(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const booleanOrDefault = (key) => typeof source[key] === "boolean" ? source[key] : null;
  const width = (panel) => {
    const number = source[`${panel}Width`];
    const limits = WORKBENCH_PANEL_LIMITS[panel];
    return typeof number === "number" && Number.isFinite(number)
      ? Math.min(limits.max, Math.max(limits.min, Math.round(number))) : null;
  };
  return {
    navigatorOpen: booleanOrDefault("navigatorOpen"),
    inspectorOpen: booleanOrDefault("inspectorOpen"),
    navigatorWidth: width("navigator"),
    inspectorWidth: width("inspector"),
    navigatorTab: source.navigatorTab === "design" ? "design" : "hierarchy",
    inspectorTab: ["connections", "timing", "adjust"].includes(source.inspectorTab)
      ? source.inspectorTab : "connections"
  };
}
