// Sweep horizontal spans in x. Active buckets are indexed by their sorted y
// coordinate, so a long sparse wire costs two updates, independent of length.
export function forEachPerpendicularPair(segments, tolerance, visitPair) {
  const rowsByY = new Map();
  const events = [];
  for (let index = 0; index < segments.length; index++) {
    const { start, end } = segments[index];
    if (Math.abs(start.y - end.y) <= tolerance) {
      let row = rowsByY.get(start.y);
      if (!row) {
        row = { y: start.y, active: new Set() };
        rowsByY.set(start.y, row);
      }
      events.push({ x: Math.min(start.x, end.x) - tolerance, order: 0, row, index });
      events.push({ x: Math.max(start.x, end.x) + tolerance, order: 2, row, index });
    } else {
      events.push({ x: start.x, order: 1, index });
    }
  }
  if (!rowsByY.size || events.length === 2 * segments.length) return;
  const rows = [...rowsByY.values()].sort((a, b) => a.y - b.y);
  let base = 1;
  while (base < rows.length) base *= 2;
  const occupied = new Uint32Array(base * 2);
  rows.forEach((row, index) => { row.slot = base + index; });
  events.sort((a, b) => a.x - b.x || a.order - b.order);
  for (const event of events) {
    if (event.row) {
      const { row } = event;
      if (event.order === 0) row.active.add(event.index);
      else row.active.delete(event.index);
      const delta = event.order === 0 ? 1 : -1;
      for (let slot = row.slot; slot; slot = Math.floor(slot / 2)) occupied[slot] += delta;
    } else {
      const vertical = segments[event.index];
      const low = Math.min(vertical.start.y, vertical.end.y) - tolerance;
      const high = Math.max(vertical.start.y, vertical.end.y) + tolerance;
      visitRows(1, 0, base - 1, low, high, event.index);
    }
  }

  function visitRows(slot, left, right, low, high, verticalIndex) {
    if (!occupied[slot] || rows[left].y > high || rows[Math.min(right, rows.length - 1)].y < low) return;
    if (left === right) {
      for (const horizontalIndex of rows[left].active) visitPair(horizontalIndex, verticalIndex);
      return;
    }
    const middle = Math.floor((left + right) / 2);
    visitRows(slot * 2, left, middle, low, high, verticalIndex);
    visitRows(slot * 2 + 1, middle + 1, right, low, high, verticalIndex);
  }
}
