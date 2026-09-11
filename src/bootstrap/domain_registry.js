import { defineDomainFeature } from "../contracts/domain_feature.js";

export function createDomainRegistry(features = []) {
  const featureById = new Map();
  for (const candidate of features) {
    if (!candidate?.id) throw new Error("Cannot register a domain without an id");
    const feature = defineDomainFeature(candidate);
    if (featureById.has(feature.id)) throw new Error(`Duplicate domain feature: ${feature.id}`);
    featureById.set(feature.id, feature);
  }
  return Object.freeze({
    get: (domainId) => featureById.get(domainId) || null,
    hasCapability(domainId, capabilityId) {
      return featureById.get(domainId)?.capabilities?.[capabilityId] === true;
    },
    contributions(domainId, kind) {
      const values = featureById.get(domainId)?.[kind];
      return Array.isArray(values) ? [...values] : [];
    },
    require(domainId) {
      const feature = featureById.get(domainId);
      if (!feature) throw new Error(`Unknown domain feature: ${domainId}`);
      return feature;
    },
    list: () => [...featureById.values()]
  });
}
