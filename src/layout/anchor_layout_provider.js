import { MeasuredAnchorLayoutProvider } from "./measured_anchor_layout.js";
import { measureLegacyLayoutGraph, restoreLegacyLayoutGraph } from "./legacy_measurement.js";
export { ANCHOR_LAYERED_LAYOUT_PROVIDER_ID, NATIVE_LAYERED_LAYOUT_PROVIDER_ID } from "./measured_anchor_layout.js";

// Keep the public raw-schematic API for offline callers. Product workspaces use
// layoutMeasured, whose complete geometry never goes through this adapter.
export class AnchorLayeredLayoutProvider extends MeasuredAnchorLayoutProvider {
  async layout(graph, options = {}) {
    const result = await this.layoutMeasured(measureLegacyLayoutGraph(graph, {
      cellPinPitch: options.layoutPolicy?.spacing?.cellPinPitch,
      focusedOrderGroups: true
    }), options);
    return restoreLegacyLayoutGraph(result, graph);
  }
}
export const NativeLayeredLayoutProvider = AnchorLayeredLayoutProvider;
