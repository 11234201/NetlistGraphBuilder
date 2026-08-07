export class SpatialHashIndex {
  constructor(cellSize = 128) {
    this.cellSize = Math.max(16, Number(cellSize) || 128);
    this.buckets = new Map();
  }

  insert(item, box) {
    const range = getCellRange(box, this.cellSize);
    for (let column = range.minColumn; column <= range.maxColumn; column += 1) {
      let rows = this.buckets.get(column);
      if (!rows) {
        rows = new Map();
        this.buckets.set(column, rows);
      }
      for (let row = range.minRow; row <= range.maxRow; row += 1) {
        if (!rows.has(row)) rows.set(row, []);
        rows.get(row).push(item);
      }
    }
    return item;
  }

  query(box) {
    const range = getCellRange(box, this.cellSize);
    if (range.minColumn === range.maxColumn && range.minRow === range.maxRow) {
      const bucket = this.buckets.get(range.minColumn)?.get(range.minRow);
      if (!bucket || bucket.length === 0) return [];
      return bucket.length === 1 ? bucket.slice() : [...new Set(bucket)];
    }

    const found = new Set();
    for (let column = range.minColumn; column <= range.maxColumn; column += 1) {
      const rows = this.buckets.get(column);
      if (!rows) continue;
      for (let row = range.minRow; row <= range.maxRow; row += 1) {
        for (const item of rows.get(row) || []) found.add(item);
      }
    }
    return [...found];
  }
}

export class RouteSegmentIndex {
  constructor(segments = [], cellSize = 128) {
    this.items = [];
    this.index = new SpatialHashIndex(cellSize);
    this.push(...segments);
  }

  push(...segments) {
    for (const segment of segments) {
      this.items.push(segment);
      this.index.insert(segment, segmentBox(segment));
    }
    return this.items.length;
  }

  querySegment(segment, padding = 0) {
    return this.index.query(segmentBox(segment, padding));
  }

  queryBox(box) {
    return this.index.query(box);
  }

  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }

  get length() {
    return this.items.length;
  }
}

export function createNodeSpatialIndex(nodes, cellSize = 128) {
  const index = new SpatialHashIndex(cellSize);
  for (const node of nodes) {
    index.insert(node, {
      left: node.x,
      right: node.x + node.width,
      top: node.y,
      bottom: node.y + node.height
    });
  }
  return index;
}

export function computeNodeCollectionBox(nodes, padding = 0) {
  if (!nodes || nodes.length === 0) {
    return { left: 0, right: 0, top: 0, bottom: 0 };
  }
  return {
    left: Math.min(...nodes.map((node) => node.x)) - padding,
    right: Math.max(...nodes.map((node) => node.x + node.width)) + padding,
    top: Math.min(...nodes.map((node) => node.y)) - padding,
    bottom: Math.max(...nodes.map((node) => node.y + node.height)) + padding
  };
}

export function segmentBox(segment, padding = 0) {
  return {
    left: Math.min(segment.start.x, segment.end.x) - padding,
    right: Math.max(segment.start.x, segment.end.x) + padding,
    top: Math.min(segment.start.y, segment.end.y) - padding,
    bottom: Math.max(segment.start.y, segment.end.y) + padding
  };
}

function getCellRange(box, cellSize) {
  const left = Math.min(box.left, box.right);
  const right = Math.max(box.left, box.right);
  const top = Math.min(box.top, box.bottom);
  const bottom = Math.max(box.top, box.bottom);
  return {
    minColumn: Math.floor(left / cellSize),
    maxColumn: Math.floor(right / cellSize),
    minRow: Math.floor(top / cellSize),
    maxRow: Math.floor(bottom / cellSize)
  };
}
