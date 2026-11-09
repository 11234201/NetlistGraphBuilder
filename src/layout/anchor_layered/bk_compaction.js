import { verticalSpacing } from './bk_alignment.js';

export function compactBlocks(context, layout) {
  const { root, align, innerShift, blocks, horizontal, vertical } = layout;
  const down = vertical === 'DOWN', extrema = down ? Math.max : Math.min, invalid = down ? -Infinity : Infinity;
  const ids = context.graph.layers.flatMap((layer) => layer.nodeIds);
  const sink = new Map(ids.map((id) => [id, id])), shift = new Map(ids.map((id) => [id, down ? Infinity : -Infinity]));
  const y = new Map(), finished = new Set(), used = new Set(), deferred = [], classEdges = [];
  const anchor = (portId) => { const port = context.ports.get(portId); return port.y + port.anchor.y; };
  const pick = (free, isRoot) => {
    const useIncoming = isRoot ? horizontal === 'RIGHT' : horizontal === 'LEFT';
    let hasEdges = false;
    for (const edge of context.incident.get(free)) {
      if ((useIncoming ? edge.targetNodeId : edge.sourceNodeId) !== free) continue;
      if (!layout.onlyDummies.get(root.get(free)) && edge.segmentKind !== 'inter_layer') continue;
      if (used.has(root.get(free))) continue;
      hasEdges = true;
      const other = edge.sourceNodeId === free ? edge.targetNodeId : edge.sourceNodeId;
      if (finished.has(root.get(other))) return { free, isRoot, edge, hasEdges };
    }
    return { free, isRoot, edge: null, hasEdges };
  };
  const bound = (free, isRoot) => {
    const selected = pick(free, isRoot);
    if (!selected.edge) { if (selected.hasEdges) deferred.push(selected); return invalid; }
    const edge = selected.edge, sourceFree = edge.sourceNodeId === free;
    const other = sourceFree ? edge.targetNodeId : edge.sourceNodeId;
    used.add(root.get(free)); used.add(root.get(other));
    return y.get(root.get(other)) + innerShift.get(other)
      + anchor(sourceFree ? edge.targetPortId : edge.sourcePortId)
      - innerShift.get(free) - anchor(sourceFree ? edge.sourcePortId : edge.targetPortId);
  };
  const threshold = (previous, block, current) => {
    if (!context.graph.options.edgeStraightening) return invalid;
    const isRoot = block === current, isLast = align.get(current) === block;
    if (!isRoot && !isLast) return previous;
    let result = previous;
    if (isRoot) result = bound(current, true);
    if (!Number.isFinite(result) && isLast) result = bound(current, false);
    return result;
  };
  const neighbor = (id, direction) => {
    const node = context.nodes.get(id), position = context.position.get(id);
    return context.graph.layers[node.layer].nodeIds[position + direction];
  };
  const orderedLayers = horizontal === 'LEFT' ? [...context.graph.layers].reverse() : context.graph.layers;
  const roots = orderedLayers.flatMap((layer) => down ? layer.nodeIds : [...layer.nodeIds].reverse())
    .filter((id) => root.get(id) === id);
  // Explicit dependency stack avoids JS recursion depth depending on graph size.
  for (const block of roots) {
    if (y.has(block)) continue;
    y.set(block, 0);
    const stack = [{ block, index: 0, initial: true, threshold: invalid }];
    while (stack.length) {
      const frame = stack.at(-1), members = blocks.get(frame.block);
      if (frame.index === members.length) { finished.add(frame.block); stack.pop(); continue; }
      const current = members[frame.index], adjacent = neighbor(current, down ? -1 : 1);
      const adjacentRoot = adjacent === undefined ? undefined : root.get(adjacent);
      if (adjacentRoot !== undefined && !y.has(adjacentRoot)) {
        y.set(adjacentRoot, 0); stack.push({ block: adjacentRoot, index: 0, initial: true, threshold: invalid }); continue;
      }
      frame.threshold = threshold(frame.threshold, frame.block, current);
      if (adjacent !== undefined) {
        if (sink.get(frame.block) === frame.block) sink.set(frame.block, sink.get(adjacentRoot));
        const node = context.nodes.get(current), other = context.nodes.get(adjacent);
        if (sink.get(frame.block) === sink.get(adjacentRoot)) {
          const gap = verticalSpacing(node, other, context.graph.options);
          const position = down
            ? y.get(adjacentRoot) + innerShift.get(adjacent) + other.height + other.margins.bottom
              + gap + node.margins.top - innerShift.get(current)
            : y.get(adjacentRoot) + innerShift.get(adjacent) - other.margins.top
              - gap - node.margins.bottom - node.height - innerShift.get(current);
          const proposed = extrema(position, frame.threshold);
          y.set(frame.block, frame.initial ? proposed : extrema(y.get(frame.block), proposed));
          frame.initial = false;
        } else {
          const gap = context.graph.options.nodeNodeSpacing;
          const separation = down
            ? y.get(frame.block) + innerShift.get(current) - node.margins.top - y.get(adjacentRoot)
              - innerShift.get(adjacent) - other.height - other.margins.bottom - gap
            : y.get(frame.block) + innerShift.get(current) + node.height + node.margins.bottom + gap
              - y.get(adjacentRoot) - innerShift.get(adjacent) + other.margins.top;
          classEdges.push({ source: sink.get(frame.block), target: sink.get(adjacentRoot), separation });
        }
      }
      frame.index++;
    }
  }
  const classIds = [...new Set(classEdges.flatMap((edge) => [edge.source, edge.target]))];
  const incoming = new Map(classIds.map((id) => [id, 0])), outgoing = new Map(classIds.map((id) => [id, []]));
  for (const edge of classEdges) { incoming.set(edge.target, incoming.get(edge.target) + 1); outgoing.get(edge.source).push(edge); }
  const ready = classIds.filter((id) => incoming.get(id) === 0), classShifts = new Map();
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index]; if (!classShifts.has(id)) classShifts.set(id, 0);
    for (const edge of outgoing.get(id)) {
      const value = classShifts.get(id) + edge.separation;
      classShifts.set(edge.target, classShifts.has(edge.target) ? (down ? Math.min : Math.max)(classShifts.get(edge.target), value) : value);
      incoming.set(edge.target, incoming.get(edge.target) - 1);
      if (incoming.get(edge.target) === 0) ready.push(edge.target);
    }
  }
  const classFeasible = ready.length === classIds.length;
  for (const [id, value] of classShifts) shift.set(id, value);
  for (const block of blocks.keys()) {
    const value = shift.get(sink.get(block)); if (Number.isFinite(value)) y.set(block, y.get(block) + value);
  }
  const absolute = (id) => y.get(root.get(id)) + innerShift.get(id);
  const moveDeferred = (selected) => {
    const { free, edge } = selected, block = root.get(free), sourceFree = edge.sourceNodeId === free;
    const other = sourceFree ? edge.targetNodeId : edge.sourceNodeId;
    const delta = absolute(free) + anchor(sourceFree ? edge.sourcePortId : edge.targetPortId)
      - absolute(other) - anchor(sourceFree ? edge.targetPortId : edge.sourcePortId);
    if (!delta) return false;
    let available = Math.abs(delta);
    for (const current of blocks.get(block)) {
      const adjacent = neighbor(current, delta > 0 ? -1 : 1);
      if (adjacent === undefined) continue;
      const node = context.nodes.get(current), otherNode = context.nodes.get(adjacent);
      const gap = verticalSpacing(node, otherNode, context.graph.options);
      available = Math.min(available, delta > 0
        ? absolute(current) - node.margins.top - absolute(adjacent) - otherNode.height - otherNode.margins.bottom - gap
        : absolute(adjacent) - otherNode.margins.top - absolute(current) - node.height - node.margins.bottom - gap);
    }
    if (available < 0) return false; // Infeasible candidate is rejected by the authoritative order check.
    y.set(block, y.get(block) + (delta > 0 ? -available : available));
    return available > 0;
  };
  const retry = [];
  for (const pending of deferred) {
    const selected = pick(pending.free, pending.isRoot);
    if (selected.edge && !moveDeferred(selected)) retry.push(selected);
  }
  for (let i = retry.length - 1; i >= 0; i--) moveDeferred(retry[i]);
  const nodeY = new Map(ids.map((id) => [id, absolute(id)]));
  let feasible = classFeasible;
  for (const layer of context.graph.layers) for (let i = 1; i < layer.nodeIds.length; i++) {
    const above = context.nodes.get(layer.nodeIds[i - 1]), below = context.nodes.get(layer.nodeIds[i]);
    if (nodeY.get(below.id) - below.margins.top < nodeY.get(above.id) + above.height + above.margins.bottom
      + verticalSpacing(above, below, context.graph.options) - 1e-8) feasible = false;
  }
  if ([...nodeY.values()].some((value) => !Number.isFinite(value))) feasible = false;
  const minimum = ids.length ? Math.min(...[...blocks.keys()].map((id) => y.get(id))) : 0;
  const maximum = ids.length ? Math.max(...[...blocks.keys()].map((id) => y.get(id) + layout.blockSize.get(id))) : 0;
  return { ...layout, sink, shift, y, nodeY, classEdges, classShifts, feasible, size: maximum - minimum };
}
