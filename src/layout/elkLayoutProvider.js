import { MeasuredElkLayoutProvider } from "./measured_elk_layout.js";
import { measureLegacyLayoutGraph, restoreLegacyLayoutGraph } from "./legacy_measurement.js";
export { ELK_LAYOUT_PROVIDER_ID } from "./measured_elk_layout.js";

export class ElkLayoutProvider extends MeasuredElkLayoutProvider {
  async layout(graph, options = {}) {
    const result = await this.layoutMeasured(measureLegacyLayoutGraph(graph, {
      cellPinPitch: options.layoutPolicy?.spacing?.cellPinPitch,
      nodeSizes: options.nodeSizes
    }), options);
    return restoreLegacyLayoutGraph(result, graph);
  }
}
