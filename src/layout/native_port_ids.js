const VIRTUAL_ROLES = ["source", "target"];

// Preserve IDs (and therefore existing ordering/digests) for unambiguous
// inputs. On a collision, encode EVERY endpoint with an injective tuple so an
// encoded ID cannot collide with another endpoint's unchanged legacy ID.
export function createNativePortIdEncoder(nodes) {
  // On validated nodes, a suffix without a leading ':' or an internal '::'
  // is recoverable after the last '::'. Virtual suffixes also obey this rule.
  // The usual schematic IDs need no temporary strings or collision Set.
  if (!hasAmbiguousPortSuffix(nodes)) return legacyPortId;
  const ids = new Set();
  for (const node of nodes) {
    if (node.ports.length) {
      for (const port of node.ports) {
        const id = legacyPortId(node.id, port);
        if (ids.has(id)) return tuplePortId;
        ids.add(id);
      }
    } else {
      for (const role of VIRTUAL_ROLES) {
        const id = legacyPortId(node.id, null, role);
        if (ids.has(id)) return tuplePortId;
        ids.add(id);
      }
    }
  }
  return legacyPortId;
}

function hasAmbiguousPortSuffix(nodes) {
  for (const node of nodes) for (const port of node.ports) {
    if (port.id.startsWith(":") || port.id.includes("::")) return true;
  }
  return false;
}

function legacyPortId(nodeId, port, role) {
  return `${nodeId}::${port ? port.id : `virtual:${role}`}`;
}

function tuplePortId(nodeId, port, role) {
  return JSON.stringify([nodeId, port ? "port" : "virtual", port ? port.id : role]);
}
