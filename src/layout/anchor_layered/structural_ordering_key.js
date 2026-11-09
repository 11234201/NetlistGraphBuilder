import {inputDigest} from './input_digest.js';

// Algorithm ordering identity excludes presentation names, not source provenance.
// The canonical inputDigest remains the authoritative complete input identity.
export function structuralOrderingKey(canonical) {
  return inputDigest(JSON.stringify({nodes: canonical.nodes.map(({displayName, ...node}) => node),
    edges: canonical.edges, selfLoops: canonical.selfLoops,
    physicalNets: canonical.physicalNets, options: canonical.options}));
}
