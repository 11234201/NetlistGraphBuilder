import { PhaseError, checkCancelled, freezeRecord } from './protocol.js';
import { validateProperGraph } from './validate_proper.js';
import { buildNeighborhood, alignBlocks, verticalSpacing } from './bk_alignment.js';
import { compactBlocks } from './bk_compaction.js';
import { validateP4 } from './validate_p4.js';

export function placeNodes(input, { signal, observe = true } = {}) {
  validateProperGraph(input);
  const context = buildNeighborhood(input), candidates = [];
  for (const horizontal of ['RIGHT', 'LEFT']) for (const vertical of ['DOWN', 'UP']) {
    checkCancelled(signal);
    candidates.push(compactBlocks(context, alignBlocks(context, horizontal, vertical)));
  }
  let selected = candidates.filter((candidate) => candidate.feasible)
    .reduce((best, candidate) => !best || candidate.size < best.size ? candidate : best, null);
  if (!selected) throw new PhaseError('p4', 'no-feasible-bk-candidate');
  if (!input.options.favorStraightEdges && input.nodes.length) {
    const bounds = candidates.map((candidate) => ({ minimum: Math.min(...candidate.nodeY.values()),
      maximum: Math.max(...input.nodes.map((node) => candidate.nodeY.get(node.id) + node.height)) }));
    const reference = bounds[candidates.indexOf(selected)];
    const nodeY = new Map(input.nodes.map((node) => {
      const positions = candidates.map((candidate, index) => candidate.nodeY.get(node.id)
        + (candidate.vertical === 'DOWN' ? reference.minimum - bounds[index].minimum : reference.maximum - bounds[index].maximum))
        .sort((a,b) => a-b);
      return [node.id, (positions[1] + positions[2]) / 2];
    }));
    const feasible = input.layers.every((layer) => layer.nodeIds.every((id, index) => {
      if (!index) return true;
      const above = context.nodes.get(layer.nodeIds[index-1]), below = context.nodes.get(id);
      return nodeY.get(id) - below.margins.top >= nodeY.get(above.id) + above.height + above.margins.bottom
        + verticalSpacing(above, below, input.options) - 1e-8;
    }));
    if (feasible) selected = { ...selected, nodeY, horizontal: 'BALANCED', vertical: 'BALANCED' };
  }
  const evidence = (candidate) => ({ direction: `${candidate.horizontal}${candidate.vertical}`, feasible: candidate.feasible,
    size: candidate.size, root: [...candidate.root], align: [...candidate.align], innerShift: [...candidate.innerShift],
    blockSize: [...candidate.blockSize], sink: [...candidate.sink], shift: [...candidate.shift],
    y: [...candidate.root].map(([id, rootId]) => [id, candidate.y.get(rootId)]),
    nodeY: [...candidate.nodeY], classEdges: candidate.classEdges, classShifts: [...candidate.classShifts] });
  const result = { ...input, phase: 'p4', nodes: input.nodes.map((node) => ({ ...node, y: selected.nodeY.get(node.id) })),
    phaseData: { markedEdges: [...context.marked], selected: `${selected.horizontal}${selected.vertical}`,
      candidates: observe ? candidates.map(evidence) : [] } };
  validateP4(result);
  return freezeRecord(result);
}
