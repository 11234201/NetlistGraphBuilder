import { layoutGraph } from "./simpleLayered.js";

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
  [SIMPLE_LAYOUT_PROVIDER_ID, new SimpleLayeredLayoutProvider()]
]);

export function getLayoutProvider(providerId = SIMPLE_LAYOUT_PROVIDER_ID) {
  return providers.get(providerId) || providers.get(SIMPLE_LAYOUT_PROVIDER_ID);
}

export function listLayoutProviders() {
  return [...providers.values()].map(({ id, label }) => ({ id, label }));
}

