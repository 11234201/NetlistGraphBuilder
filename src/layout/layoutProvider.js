import { layoutGraph } from "./simpleLayered.js";
import { ELK_LAYOUT_PROVIDER_ID, ElkLayoutProvider } from "./elkLayoutProvider.js";
import { DEFAULT_LAYOUT_PROVIDER_ID, FALLBACK_LAYOUT_PROVIDER_ID } from "./providerDefaults.js";
import {
  NATIVE_LAYERED_LAYOUT_PROVIDER_ID,
  NativeLayeredLayoutProvider
} from "./elk_native_layout_provider.js";

export const SIMPLE_LAYOUT_PROVIDER_ID = "simple-layered";

export class SimpleLayeredLayoutProvider {
  constructor() {
    this.id = SIMPLE_LAYOUT_PROVIDER_ID;
    this.label = "Simple Layered";
  }

  layout(graph, options = {}) {
    return layoutGraph(graph, options);
  }
}

const providers = new Map([
  [SIMPLE_LAYOUT_PROVIDER_ID, new SimpleLayeredLayoutProvider()],
  [ELK_LAYOUT_PROVIDER_ID, new ElkLayoutProvider()],
  [NATIVE_LAYERED_LAYOUT_PROVIDER_ID, new NativeLayeredLayoutProvider({ profile: "h08" })]
]);

export function getLayoutProvider(providerId = DEFAULT_LAYOUT_PROVIDER_ID) {
  return providers.get(providerId) || providers.get(FALLBACK_LAYOUT_PROVIDER_ID);
}

export function listLayoutProviders() {
  return [...providers.values()].map(({ id, label }) => ({ id, label }));
}
