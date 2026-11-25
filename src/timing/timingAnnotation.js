import { getNodeInstance } from "./timing_names.js";
import { normalizeTimingDisplayPolicy, createPortTimingObject, annotateTimingBadges } from "./timing_badges.js";
import { createModulePointMatcher, createHierarchyTimingContext, selectModuleRecords } from "./timing_scopes.js";
import {
  buildCellIndex,
  buildPortIndex,
  buildNetSourceIndex,
  getPointCandidates,
  cellsNamedInPoint,
  tryCollectCellPin,
  tryAnnotatePort,
  tryAnnotateNet,
  resolveCellTimingMatches
} from "./timing_matches.js";
import { createMatchDiagnostics, TIMING_SAMPLE_LIMIT, timingNameSample } from "./timing_diagnostics.js";
export { TIMING_BADGE_POSITIONS, TIMING_METRICS, DEFAULT_TIMING_DISPLAY_POLICY,
  normalizeTimingDisplayPolicy, normalizeBadgeChoices } from "./timing_badges.js";

export function annotateGraphTiming(graph, timing, options = {}) {
  if (!timing || !graph || !Array.isArray(graph.nodes)) {
    return graph;
  }

  const policy = normalizeTimingDisplayPolicy(options.displayPolicy);
  const badgeChoices = options.badgeChoices || {};
  const badgePositions = options.badgePositions || {};
  const unit = timing.unit || "ns";
  const stage = timing.stage || "post_map";

  const targetModuleName = graph.timingModuleName || graph.moduleName;
  const moduleMatcher = createModulePointMatcher(targetModuleName);
  const hierarchyContext = createHierarchyTimingContext(graph, targetModuleName, options);
  if (!timing.records?.length) return graph;
  const cellIndex = buildCellIndex(graph.nodes);
  const diagnostics = createMatchDiagnostics(timing, hierarchyContext, (point) => cellsNamedInPoint(point, cellIndex));
  const withEvidence = (node) => diagnostics.byCell.has(node.id)
    ? { ...node, timingMatchEvidence: diagnostics.byCell.get(node.id) } : node;
  const scopedItems = selectModuleRecords(timing, hierarchyContext, diagnostics);
  const summary = { stage, unit, policy, scopedRecordCount: scopedItems.length, diagnostics: diagnostics.details };
  if (scopedItems.length === 0) {
    diagnostics.summarizeCells(graph.nodes);
    return { ...graph, nodes: graph.nodes.map(withEvidence),
      timingSummary: { ...summary, candidateMatchedRecordCount: 0, matchedRecordCount: 0, unmatchedRecordCount: 0 } };
  }

  const portIndex = buildPortIndex(graph.nodes);
  const netTopology = buildNetSourceIndex(graph);

  const cellPinGroups = new Map();
  const portTimingByNodeId = new Map();
  const netTiming = Object.create(null);
  const matchedOccurrenceKeys = new Set();
  let candidateMatchedRecordCount = 0;

  const recordMatch = (match, record) => {
    candidateMatchedRecordCount += 1;
    if (match.targetKind && typeof record.point === "string" && record.point.includes("/")) diagnostics.otherTarget(record, match.targetKind);
    if (match?.occurrenceKey) {
      matchedOccurrenceKeys.add(match.occurrenceKey);
    }
  };
  for (const item of scopedItems) {
    const { record, stripPrefixes, allowModulePattern, allowPortPrefix } = item;
    const candidates = getPointCandidates(
      record.point,
      moduleMatcher,
      stripPrefixes,
      allowModulePattern,
      allowPortPrefix
    );
    const explicitKind = record.kind || null;

    if (explicitKind === "pin") {
      const match =
        tryCollectCellPin(record, candidates, cellIndex, cellPinGroups, portIndex) ||
        tryAnnotatePort(record, candidates, portIndex, portTimingByNodeId);
      if (match) recordMatch(match, record);
      else diagnostics.unmatched(record, candidates);
      continue;
    }

    if (explicitKind === "port") {
      const match =
        tryAnnotatePort(record, candidates, portIndex, portTimingByNodeId) ||
        tryCollectCellPin(record, candidates, cellIndex, cellPinGroups, portIndex);
      if (match) recordMatch(match, record);
      else diagnostics.unmatched(record, candidates);
      continue;
    }

    if (explicitKind === "net") {
      const match = tryAnnotateNet(
        record,
        candidates,
        netTopology,
        netTiming,
        cellPinGroups,
        portTimingByNodeId, diagnostics
      );
      if (match) recordMatch(match, record);
      else diagnostics.unmatched(record, candidates);
      continue;
    }

    // Default disambiguation when kind is omitted:
    // 1. Cell Pin (validated against existing cells in graph, unless exact port name takes precedence when pin doesn't exist)
    const pinMatch = tryCollectCellPin(record, candidates, cellIndex, cellPinGroups, portIndex);
    if (pinMatch) {
      recordMatch(pinMatch, record);
      continue;
    }

    // 2. Boundary Port (supports escaped port names containing '/')
    const portMatch = tryAnnotatePort(record, candidates, portIndex, portTimingByNodeId);
    if (portMatch) {
      recordMatch(portMatch, record);
      continue;
    }

    // 3. Internal Net (resolves upstream through assign aliases to Source driver)
    const netMatch = tryAnnotateNet(
      record,
      candidates,
      netTopology,
      netTiming,
      cellPinGroups,
      portTimingByNodeId, diagnostics
    );
    if (netMatch) {
      recordMatch(netMatch, record);
      continue;
    }

    diagnostics.unmatched(record, candidates);
  }

  if (matchedOccurrenceKeys.size > 1) {
    diagnostics.summarizeCells(graph.nodes);
    const occurrenceExamples = [];
    for (const key of matchedOccurrenceKeys) {
      occurrenceExamples.push(timingNameSample(key));
      if (occurrenceExamples.length === TIMING_SAMPLE_LIMIT) break;
    }
    return {
      ...graph,
      netTiming: {},
      timingSummary: {
        ...summary,
        occurrenceExamples,
        candidateMatchedRecordCount,
        matchedRecordCount: 0,
        unmatchedRecordCount: scopedItems.length,
        ambiguousOccurrenceCount: matchedOccurrenceKeys.size
      },
      nodes: graph.nodes.map(withEvidence)
    };
  }

  const cellTimingByNodeId = resolveCellTimingMatches(cellPinGroups, cellIndex, unit, stage, diagnostics);
  const unresolvedPins = Object.values(diagnostics.details.unresolvedPins.reasons).reduce((total, count) => total + count, 0);
  const matchedRecordCount = candidateMatchedRecordCount - unresolvedPins;
  diagnostics.summarizeCells(graph.nodes, cellTimingByNodeId);

  const annotatedNodes = graph.nodes.map((node) => {
    if (node.kind === "cell") {
      const nodeTiming = cellTimingByNodeId.get(node.id);
      if (!nodeTiming) return withEvidence(node);
      const instance = getNodeInstance(node);
      return {
        ...node,
        timing: annotateTimingBadges(
          nodeTiming,
          Object.hasOwn(badgeChoices, instance) ? badgeChoices[instance] : undefined,
          Object.hasOwn(badgePositions, instance) ? badgePositions[instance] : undefined,
          node,
          policy
        )
      };
    }

    if (node.kind === "input" || node.kind === "output") {
      const portRecord = portTimingByNodeId.get(node.id);
      if (!portRecord) return node;
      const instance = getNodeInstance(node);
      const portTiming = createPortTimingObject(node, portRecord, unit, stage);
      return {
        ...node,
        timing: annotateTimingBadges(
          portTiming,
          Object.hasOwn(badgeChoices, instance) ? badgeChoices[instance] : undefined,
          Object.hasOwn(badgePositions, instance) ? badgePositions[instance] : undefined,
          node,
          policy
        )
      };
    }

    return node;
  });

  return {
    ...graph,
    netTiming: { ...netTiming },
    timingSummary: {
      ...summary,
      matchedRecordCount,
      candidateMatchedRecordCount,
      unmatchedRecordCount: scopedItems.length - matchedRecordCount
    },
    nodes: annotatedNodes
  };
}
