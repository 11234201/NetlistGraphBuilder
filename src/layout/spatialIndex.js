export class SpatialHashIndex {
  constructor(cellSize = 128) {
    this.cellSize = Math.max(16, Number(cellSize) || 128);
    this.buckets = new Map();
  }

  insert(item, box) {
    for (const key of this.#keysForBox(box)) {
      if (!this.buckets.has(key)) this.buckets.set(key, []);
      this.buckets.get(key).push(item);
    }
    return item;
  }

  query(box) {
    const found = new Set();
    for (const key of this.#keysForBox(box)) {
      for (const item of this.buckets.get(key) || []) found.add(item);
    }
    return [...found];
  }

  #keysForBox(box) {
    const left = Math.min(box.left, box.right);
    const right = Math.max(box.left, box.right);
    const top = Math.min(box.top, box.bottom);
    const bottom = Math.max(box.top, box.bottom);
    const minColumn = Math.floor(left / this.cellSize);
    const maxColumn = Math.floor(right / this.cellSize);
    const minRow = Math.floor(top / this.cellSize);
    const maxRow = Math.floor(bottom / this.cellSize);
    const keys = [];
    for (let column = minColumn; column <= maxColumn; column += 1) {
      for (let row = minRow; row <= maxRow; row += 1) keys.push(`${column}:${row}`);
    }
    return keys;
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

export function segmentBox(segment, padding = 0) {
  return {
    left: Math.min(segment.start.x, segment.end.x) - padding,
    right: Math.max(segment.start.x, segment.end.x) + padding,
    top: Math.min(segment.start.y, segment.end.y) - padding,
    bottom: Math.max(segment.start.y, segment.end.y) + padding
  };
}
