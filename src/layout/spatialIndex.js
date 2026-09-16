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
    const visitRows = (rows) => {
      if (!rows) return;
      const rowSpan = range.maxRow - range.minRow + 1;
      if (rowSpan <= rows.size * 2) {
        for (let row = range.minRow; row <= range.maxRow; row += 1) {
          for (const item of rows.get(row) || []) found.add(item);
        }
        return;
      }
      for (const [row, items] of rows) {
        if (row < range.minRow || row > range.maxRow) continue;
        for (const item of items) found.add(item);
      }
    };
    const columnSpan = range.maxColumn - range.minColumn + 1;
    if (columnSpan <= this.buckets.size * 2) {
      for (let column = range.minColumn; column <= range.maxColumn; column += 1) {
        visitRows(this.buckets.get(column));
      }
    } else {
      for (const [column, rows] of this.buckets) {
        if (column < range.minColumn || column > range.maxColumn) continue;
        visitRows(rows);
      }
    }
    return [...found];
  }
}

export class RouteSegmentIndex {
  constructor(segments = [], cellSize = 128) {
    this.items = [];
    this.inactiveSegments = new Set();
    this.geometryKeys = new Set();
    this.duplicateInsertions = 0;
    this.ownerReplacements = 0;
    this.ownerRemovals = 0;
    this.cellSize = Math.max(16, Number(cellSize) || 128);
    this.horizontalBuckets = new Map();
    this.verticalBuckets = new Map();
    this.otherIndex = new SpatialHashIndex(this.cellSize);
    this.push(...segments);
  }

  push(...segments) {
    for (const segment of segments) {
      this.inactiveSegments.delete(segment);
      const geometryKey = routeSegmentGeometryKey(segment);
      if (this.geometryKeys.has(geometryKey)) this.duplicateInsertions += 1;
      this.items.push(segment);
      this.geometryKeys.add(geometryKey);
      const record = {
        segment,
        box: segmentBox(segment)
      };
      const dx = Math.abs(segment.end.x - segment.start.x);
      const dy = Math.abs(segment.end.y - segment.start.y);
      if (dy < 0.5) {
        insertAxisBucket(
          this.horizontalBuckets,
          Math.floor(segment.start.y / this.cellSize),
          record
        );
      } else if (dx < 0.5) {
        insertAxisBucket(
          this.verticalBuckets,
          Math.floor(segment.start.x / this.cellSize),
          record
        );
      } else {
        this.otherIndex.insert(record, record.box);
      }
    }
    return this.items.length;
  }

  pushUnique(...segments) {
    const accepted = [];
    const acceptedKeys = new Set();
    for (const segment of segments) {
      const key = routeSegmentGeometryKey(segment);
      if (this.geometryKeys.has(key) || acceptedKeys.has(key)) {
        this.duplicateInsertions += 1;
        continue;
      }
      acceptedKeys.add(key);
      accepted.push(segment);
    }
    if (accepted.length > 0) this.push(...accepted);
    return this.items.length;
  }

  removeOwner(owner) {
    const removed = this.items.filter((segment) =>
      (segment?.physicalOwner ?? segment?.netGroupKey ?? segment?.net) === owner);
    if (removed.length === 0) return this.items.length;
    for (const segment of removed) {
      this.inactiveSegments.add(segment);
      this.geometryKeys.delete(routeSegmentGeometryKey(segment));
    }
    this.items = this.items.filter((segment) => !this.inactiveSegments.has(segment));
    this.ownerRemovals += 1;
    return this.items.length;
  }

  replaceOwner(owner, segments = []) {
    this.ownerReplacements += 1;
    this.removeOwner(owner);
    this.pushUnique(...segments.map((segment) => ({ ...segment, physicalOwner: owner })));
    return this.items.length;
  }

  compact() {
    const current = [...this.items];
    this.rebuild(current);
    return this.items.length;
  }

  get metrics() {
    return {
      uniqueSegments: this.items.length,
      duplicateInsertions: this.duplicateInsertions,
      ownerReplacements: this.ownerReplacements,
      ownerRemovals: this.ownerRemovals
    };
  }

  rebuild(segments = []) {
    this.items = [];
    this.inactiveSegments = new Set();
    this.geometryKeys = new Set();
    this.horizontalBuckets = new Map();
    this.verticalBuckets = new Map();
    this.otherIndex = new SpatialHashIndex(this.cellSize);
    this.push(...segments);
    return this.items.length;
  }

  querySegment(segment, padding = 0) {
    return this.queryBox(segmentBox(segment, padding));
  }

  queryVerticalSegment(segment, padding = 0) {
    const box = segmentBox(segment, padding);
    const found = new Set();
    queryAxisBuckets(
      this.verticalBuckets,
      Math.floor(box.left / this.cellSize),
      Math.floor(box.right / this.cellSize),
      box,
      found
    );
    return [...found]
      .filter((record) => !this.inactiveSegments.has(record.segment))
      .map((record) => record.segment);
  }

  queryBox(box) {
    const found = new Set();
    queryAxisBuckets(
      this.horizontalBuckets,
      Math.floor(Math.min(box.top, box.bottom) / this.cellSize),
      Math.floor(Math.max(box.top, box.bottom) / this.cellSize),
      box,
      found
    );
    queryAxisBuckets(
      this.verticalBuckets,
      Math.floor(Math.min(box.left, box.right) / this.cellSize),
      Math.floor(Math.max(box.left, box.right) / this.cellSize),
      box,
      found
    );
    for (const record of this.otherIndex.query(box)) {
      if (boxesIntersect(record.box, box)) found.add(record);
    }
    return [...found]
      .filter((record) => !this.inactiveSegments.has(record.segment))
      .map((record) => record.segment);
  }

  countBox(box, predicate, maximum = Infinity) {
    let count = 0;
    const visit = (segment) => {
      if (this.inactiveSegments.has(segment)) return false;
      if (!predicate(segment)) return false;
      count += 1;
      return count >= maximum;
    };
    if (someAxisBuckets(
      this.horizontalBuckets,
      Math.floor(Math.min(box.top, box.bottom) / this.cellSize),
      Math.floor(Math.max(box.top, box.bottom) / this.cellSize),
      box,
      visit
    )) return count;
    if (someAxisBuckets(
      this.verticalBuckets,
      Math.floor(Math.min(box.left, box.right) / this.cellSize),
      Math.floor(Math.max(box.left, box.right) / this.cellSize),
      box,
      visit
    )) return count;
    for (const record of this.otherIndex.query(box)) {
      if (boxesIntersect(record.box, box) && visit(record.segment)) break;
    }
    return count;
  }

  countVerticalSegment(segment, padding, predicate, maximum = Infinity) {
    return countAxisMatches(
      this.verticalBuckets,
      segmentBox(segment, padding),
      "x",
      this.cellSize,
      this.inactiveSegments,
      predicate,
      maximum
    );
  }

  countHorizontalSegment(segment, padding, predicate, maximum = Infinity) {
    return countAxisMatches(
      this.horizontalBuckets,
      segmentBox(segment, padding),
      "y",
      this.cellSize,
      this.inactiveSegments,
      predicate,
      maximum
    );
  }

  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }

  get length() {
    return this.items.length;
  }
}

export class NodeSpatialIndex extends SpatialHashIndex {
  constructor(nodes = [], cellSize = 128) {
    super(cellSize);
    this.horizontalBuckets = new Map();
    this.verticalBuckets = new Map();
    for (const node of nodes) this.insertNode(node);
  }

  insertNode(node) {
    const box = {
      left: node.x,
      right: node.x + node.width,
      top: node.y,
      bottom: node.y + node.height
    };
    super.insert(node, box);
    const record = { segment: node, box };
    insertRecordRange(
      this.verticalBuckets,
      Math.floor(box.left / this.cellSize),
      Math.floor(box.right / this.cellSize),
      record
    );
    insertRecordRange(
      this.horizontalBuckets,
      Math.floor(box.top / this.cellSize),
      Math.floor(box.bottom / this.cellSize),
      record
    );
    return node;
  }

  queryVerticalSegment(segment, padding = 0) {
    return queryNodeAxis(
      this.verticalBuckets,
      segmentBox(segment, padding),
      "x",
      this.cellSize
    );
  }

  queryHorizontalSegment(segment, padding = 0) {
    return queryNodeAxis(
      this.horizontalBuckets,
      segmentBox(segment, padding),
      "y",
      this.cellSize
    );
  }
}

function countAxisMatches(buckets, box, axis, cellSize, inactiveSegments, predicate, maximum) {
  let count = 0;
  const minimum = Math.floor((axis === "x" ? Math.min(box.left, box.right) : Math.min(box.top, box.bottom)) / cellSize);
  const maximumBucket = Math.floor((axis === "x" ? Math.max(box.left, box.right) : Math.max(box.top, box.bottom)) / cellSize);
  someAxisBuckets(buckets, minimum, maximumBucket, box, (segment) => {
    if (inactiveSegments.has(segment) || !predicate(segment)) return false;
    count += 1;
    return count >= maximum;
  });
  return count;
}

function insertAxisBucket(buckets, key, record) {
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(record);
}

function routeSegmentGeometryKey(segment) {
  const start = `${Number(segment?.start?.x) || 0},${Number(segment?.start?.y) || 0}`;
  const end = `${Number(segment?.end?.x) || 0},${Number(segment?.end?.y) || 0}`;
  const geometry = start < end ? `${start}|${end}` : `${end}|${start}`;
  return `${segment?.physicalOwner ?? segment?.netGroupKey ?? segment?.net ?? ""}\u0000${geometry}`;
}

function queryAxisBuckets(buckets, minimum, maximum, box, found) {
  const span = maximum - minimum + 1;
  if (span <= buckets.size * 2) {
    for (let key = minimum; key <= maximum; key += 1) {
      collectIntersectingRecords(buckets.get(key), box, found);
    }
    return;
  }
  for (const [key, records] of buckets) {
    if (key < minimum || key > maximum) continue;
    collectIntersectingRecords(records, box, found);
  }
}

function someAxisBuckets(buckets, minimum, maximum, box, predicate) {
  const visit = (records) => {
    for (const record of records || []) {
      if (boxesIntersect(record.box, box) && predicate(record.segment)) return true;
    }
    return false;
  };
  const span = maximum - minimum + 1;
  if (span <= buckets.size * 2) {
    for (let key = minimum; key <= maximum; key += 1) {
      if (visit(buckets.get(key))) return true;
    }
    return false;
  }
  for (const [key, records] of buckets) {
    if (key >= minimum && key <= maximum && visit(records)) return true;
  }
  return false;
}

function collectIntersectingRecords(records, box, found) {
  for (const record of records || []) {
    if (boxesIntersect(record.box, box)) found.add(record);
  }
}

function boxesIntersect(left, right) {
  return left.right >= Math.min(right.left, right.right) &&
    left.left <= Math.max(right.left, right.right) &&
    left.bottom >= Math.min(right.top, right.bottom) &&
    left.top <= Math.max(right.top, right.bottom);
}

export function createNodeSpatialIndex(nodes, cellSize = 128) {
  return new NodeSpatialIndex(nodes, cellSize);
}

function insertRecordRange(buckets, minimum, maximum, record) {
  for (let key = minimum; key <= maximum; key += 1) {
    insertAxisBucket(buckets, key, record);
  }
}

function queryNodeAxis(buckets, box, axis, cellSize) {
  const minimum = Math.floor((axis === "x" ? box.left : box.top) / cellSize);
  const maximum = Math.floor((axis === "x" ? box.right : box.bottom) / cellSize);
  const found = new Set();
  queryAxisBuckets(buckets, minimum, maximum, box, found);
  return [...found].map((record) => record.segment);
}

export function computeNodeCollectionBox(nodes, padding = 0) {
  if (!nodes || nodes.length === 0) {
    return { left: 0, right: 0, top: 0, bottom: 0 };
  }
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.x);
    right = Math.max(right, node.x + node.width);
    top = Math.min(top, node.y);
    bottom = Math.max(bottom, node.y + node.height);
  }
  return { left: left - padding, right: right + padding, top: top - padding, bottom: bottom + padding };
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
