import {PhaseError} from './protocol.js';

// Adapter identity transform, before canonicalization. Declared pins stay shared;
// implicit endpoints receive the existing per-logical-edge identity, without moving anchors.
export function splitImplicitEndpoints(input) {
  const nodes = input.nodes.map(node => ({...node, ports: node.ports.filter(port =>
    port.id !== `${node.id}::virtual:source` && port.id !== `${node.id}::virtual:target`)
    .map(port => ({...port}))}));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const owner = new Map(input.nodes.flatMap(node => node.ports.map(port => [port.id, {node, port}])));
  const edges = input.edges.map(edge => {
    const result = {...edge};
    for (const role of ['source', 'target']) {
      const field = `${role}PortId`, endpoint = owner.get(edge[field]);
      if (!endpoint) throw new PhaseError('adapter', 'missing-endpoint-port', [edge.id]);
      if (edge[field] === `${endpoint.node.id}::virtual:${role}`) {
        const id = `virtual:${JSON.stringify([endpoint.node.id, role, edge.id])}`;
        byId.get(endpoint.node.id).ports.push({...endpoint.port, id});
        result[field] = id;
      }
    }
    return result;
  });
  return {...input, nodes, edges};
}
