export function getElkEdgePoints(edge, sourcePoint) {
  const sections = edge?.sections;
  if (!sections?.length || sections.some((section) =>
    !finitePoint(section?.startPoint) || !finitePoint(section?.endPoint))) {
    return {
      points: [],
      status: "unroutable",
      diagnostics: [{
        code: "elk-edge-section-missing",
        edgeId: edge?.id
      }]
    };
  }
  if (!sections.every((section) => (section.bendPoints || []).every(finitePoint))) {
    return {
      points: [],
      status: "unroutable",
      diagnostics: [{
        code: "elk-edge-section-invalid-point",
        edgeId: edge?.id
      }]
    };
  }
  if (sections.length === 1) {
    const section = sections[0];
    return { points: [section.startPoint, ...(section.bendPoints || []), section.endPoint],
      status: "routed", diagnostics: [] };
  }
  // Index both endpoints. Sections may run in either direction and a loop has
  // no unmatched start, so a start-only map loses valid sections.
  const endpoints = new Map();
  for (const section of sections) {
    for (const point of [section.startPoint, section.endPoint]) {
      const key = pointKey(point);
      if (!endpoints.has(key)) endpoints.set(key, { point, sections: [] });
      endpoints.get(key).sections.push(section);
    }
  }
  const vertices = [...endpoints.values()];
  const terminals = vertices.filter(vertex => vertex.sections.length === 1);
  if (vertices.some(vertex => vertex.sections.length > 2) || ![0, 2].includes(terminals.length)) {
    return disconnected(edge);
  }
  const candidates = terminals.length ? terminals : vertices;
  candidates.sort((left, right) => {
    const distance = point => sourcePoint ? Math.abs(point.x - sourcePoint.x) + Math.abs(point.y - sourcePoint.y) : 0;
    return distance(left.point) - distance(right.point) || left.point.x - right.point.x || left.point.y - right.point.y;
  });
  let vertex = candidates[0];
  const points = [vertex.point];
  const visited = new Set();
  while (visited.size < sections.length) {
    const available = vertex.sections.filter(section => !visited.has(section));
    // At a cycle's starting vertex prefer the declared outgoing direction.
    available.sort((left, right) => {
      const leftOther = pointKey(left.startPoint) === pointKey(vertex.point) ? left.endPoint : left.startPoint;
      const rightOther = pointKey(right.startPoint) === pointKey(vertex.point) ? right.endPoint : right.startPoint;
      return leftOther.x - rightOther.x || leftOther.y - rightOther.y ||
        JSON.stringify(left.bendPoints || []).localeCompare(JSON.stringify(right.bendPoints || []));
    });
    const section = available.find(part => pointKey(part.startPoint) === pointKey(vertex.point)) || available[0];
    if (!section) return disconnected(edge);
    visited.add(section);
    const forward = pointKey(section.startPoint) === pointKey(vertex.point);
    const bends = section.bendPoints || [];
    for (let index = 0; index < bends.length; index++) {
      points.push(bends[forward ? index : bends.length - 1 - index]);
    }
    points.push(forward ? section.endPoint : section.startPoint);
    vertex = endpoints.get(pointKey(points.at(-1)));
  }
  return { points: compactElkPoints(points), status: "routed", diagnostics: [] };
}

function pointKey(point) { return JSON.stringify([Number(point.x), Number(point.y)]); }

function disconnected(edge) {
  return { points: [], status: "unroutable",
    diagnostics: [{ code: "elk-edge-sections-disconnected", edgeId: edge.id }] };
}

function finitePoint(point) {
  return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));
}

// Preserve collinear reversals, including a two-section self-loop.
export function compactElkPoints(points) {
  const result = [];
  for (const point of points) {
    if (result.length && pointKey(result.at(-1)) === pointKey(point)) continue;
    while (result.length >= 2) {
      const before = result.at(-2), middle = result.at(-1);
      const between = (a, b, c) => b >= Math.min(a, c) && b <= Math.max(a, c);
      const redundant = before.x === middle.x && middle.x === point.x && between(before.y, middle.y, point.y) ||
        before.y === middle.y && middle.y === point.y && between(before.x, middle.x, point.x);
      if (!redundant) break;
      result.pop();
    }
    result.push(point);
  }
  return result;
}
