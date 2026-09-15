import { getPhysicalNetKey } from "../layoutTopology.js";

export function buildPhysicalNetCarriers(graph = {}, levels = new Map()) {
  const levelKeys = [...new Set(levels.values())]
    .filter(Number.isFinite)
    .toSorted((left, right) => left - right);
  const columnByLevel = new Map(levelKeys.map((level, index) => [level, index]));
  const groups = new Map();
  for (const edge of [...(graph.edges || [])].toSorted(compareEdges)) {
    const key = getPhysicalNetKey(edge);
    const members = groups.get(key) || [];
    members.push(edge);
    groups.set(key, members);
  }

  const carriers = [];
  const diagnostics = [];
  for (const [netGroupKey, edges] of [...groups].toSorted(([left], [right]) => compareIds(left, right))) {
    const sourceColumns = new Set(edges.map((edge) => columnOf(edge.source, levels, columnByLevel)));
    if (sourceColumns.size !== 1 || sourceColumns.has(undefined)) {
      diagnostics.push({ code: "layered-carrier-source-column-missing", netGroupKey });
      continue;
    }
    const sourceColumn = [...sourceColumns][0];
    const targetEntries = edges.map((edge) => ({
      edge,
      column: columnOf(edge.target, levels, columnByLevel)
    }));
    if (targetEntries.some((entry) => entry.column === undefined || entry.column <= sourceColumn)) {
      diagnostics.push({ code: "layered-carrier-non-forward-edge", netGroupKey });
      continue;
    }
    const maximumTargetColumn = Math.max(...targetEntries.map((entry) => entry.column));
    for (let boundaryColumn = sourceColumn; boundaryColumn < maximumTargetColumn; boundaryColumn += 1) {
      const crossingEdges = targetEntries
        .filter((entry) => entry.column > boundaryColumn)
        .map((entry) => String(entry.edge.id || ""))
        .toSorted(compareIds);
      carriers.push({
        id: `carrier:${encodeURIComponent(netGroupKey)}:${boundaryColumn}`,
        netGroupKey,
        boundaryColumn,
        leftLevel: levelKeys[boundaryColumn],
        rightLevel: levelKeys[boundaryColumn + 1],
        logicalEdgeIds: crossingEdges
      });
    }
  }
  return { carriers, diagnostics, levelKeys };
}

function columnOf(nodeId, levels, columnByLevel) {
  return columnByLevel.get(levels.get(nodeId));
}

function compareEdges(left, right) {
  return compareIds(getPhysicalNetKey(left), getPhysicalNetKey(right)) || compareIds(left.id, right.id);
}

function compareIds(left, right) {
  return String(left || "").localeCompare(String(right || ""));
}
