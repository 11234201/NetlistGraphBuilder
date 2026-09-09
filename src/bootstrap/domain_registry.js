export function createDomainRegistry(features = []) {
  const featureById = new Map();
  for (const feature of features) {
    if (!feature?.id) throw new Error("Cannot register a domain without an id");
    if (featureById.has(feature.id)) throw new Error(`Duplicate domain feature: ${feature.id}`);
    featureById.set(feature.id, feature);
  }
  return Object.freeze({
    get: (domainId) => featureById.get(domainId) || null,
    require(domainId) {
      const feature = featureById.get(domainId);
      if (!feature) throw new Error(`Unknown domain feature: ${domainId}`);
      return feature;
    },
    list: () => [...featureById.values()]
  });
}
