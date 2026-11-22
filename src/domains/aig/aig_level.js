import { analyzeAig } from "./aig_analysis.js";
import { aigError, freezeAig } from "./aig_diagnostics.js";
import { readAigLevelRows } from "./aig_level_text.js";

// Keep one candidate or an ambiguity marker per kind. Repeated lookups of a
// common DOT label remain bounded even in graphs with many equally named gates.
function indexLevelPoints(model) {
  const names = new Map();
  const inputs = new Map();
  function addCandidate(index, key, node) {
    if (!index.has(key)) index.set(key, node);
    else if (index.get(key) !== node) index.set(key, null);
  }
  function add(name, node, port) {
    if (!name) return;
    if (!names.has(name)) names.set(name, new Map());
    const byKind = names.get(name);
    addCandidate(byKind, node.kind, node);
    if (port) addCandidate(byKind, "port", node);
    if (port && node.kind === "pi") addCandidate(inputs, name, node);
  }
  for (const node of model.nodes) {
    const isPort = node.kind === "pi" || node.kind === "po";
    const portIds = new Set();
    for (const ref of node.sourceRefs) {
      if (ref.generatedFor) continue;
      const port = isPort && !ref.alias;
      if (port) portIds.add(ref.id);
      add(ref.id, node, port);
      add(ref.label, node, port);
    }
    for (const mapping of node.nameMappings || []) {
      if (!mapping.conflict) add(mapping.name, node, portIds.has(mapping.signalId));
    }
  }
  return { names, inputs };
}

function resolvePoint({ names, inputs }, row, file) {
  const byKind = names.get(row.point);
  let candidate;
  if (byKind) {
    if (row.inputOnly) candidate = inputs.get(row.point);
    else if (row.kind) candidate = byKind.get(row.kind);
    else if (byKind.has("port")) candidate = byKind.get("port");
    else candidate = byKind.size === 1 ? byKind.values().next().value : null;
  }
  if (!candidate) {
    const name = row.point.slice(0, 150);
    const ambiguous = candidate === null;
    throw aigError(ambiguous ? `Ambiguous Level point '${name}'` : `Unknown ${row.kind || "AIG"} Level point '${name}'`,
      file, { line: row.line, column: row.column, id: name }, ambiguous ? "aig.level-ambiguous-point" : "aig.level-unknown-point");
  }
  return candidate;
}

function bindReports(model, file) {
  const points = indexLevelPoints(model);
  const reports = new Map();
  for (const row of readAigLevelRows(file)) {
    const node = resolvePoint(points, row, file);
    const { id } = node;
    if (!reports.has(id)) reports.set(id, { values: { at: null, rt: null, slack: null, slackDerived: false }, lines: {} });
    const report = reports.get(id);
    const { values, lines } = report;
    for (const [metric, value] of Object.entries(row.metrics)) {
      if (lines[metric] && values[metric] !== value)
        throw aigError(`Conflicting ${metric}_level for '${row.point.slice(0, 150)}' (first specified on line ${lines[metric]})`,
          file, { line: row.line, column: row.column, id }, "aig.level-conflict");
      values[metric] = value;
      lines[metric] ??= row.line;
    }
    // Folded BLIF buffers/inverters share their driver's report. Only an AT
    // assigned to the declared input (or its own mapped name) seeds the graph.
    if (row.metrics.at !== undefined && points.inputs.get(row.point) === node) report.seedLine ??= row.line;
  }
  for (const [id, { values, lines }] of reports) {
    if (values.slack === null && values.rt !== null && values.at !== null) {
      values.slack = values.rt - values.at;
      if (!Number.isSafeInteger(values.slack))
        throw aigError("Derived slack_level exceeds the exact integer range", file, { line: lines.rt, id }, "aig.level-overflow");
      values.slackDerived = true;
    }
  }
  return reports;
}

function deriveLevels(model, reports, file) {
  const states = new Map(model.nodes.map(node => {
    const report = reports.get(node.id);
    return [node.id, { node, level: report?.seedLine ? report.values.at : 0, seedLine: report?.seedLine, pending: 0, users: [] }];
  }));
  for (const edge of model.edges) {
    const target = states.get(edge.target);
    target.pending++;
    states.get(edge.source).users.push(target);
  }
  const ready = [...states.values()].filter(state => !state.pending);
  for (let index = 0; index < ready.length; index++) {
    const source = ready[index];
    for (const target of source.users) {
      const level = source.level + Number(target.node.kind === "and");
      if (!Number.isSafeInteger(level))
        throw aigError("PI at_level overflows the exact integer range downstream", file,
          { line: source.seedLine, id: target.node.id }, "aig.level-overflow");
      if (level > target.level) {
        target.level = level;
        target.seedLine = source.seedLine;
      }
      if (--target.pending === 0) ready.push(target);
    }
  }
  return model.nodes.map(node => {
    const level = states.get(node.id).level;
    const report = reports.get(node.id)?.values;
    if (node.level === level && !report && !node.levelReport) return node;
    const updated = { ...node, level };
    if (report) updated.levelReport = report;
    else delete updated.levelReport;
    return updated;
  });
}

// Model identity, source mappings and edge IDs come from the original design.
// Replacement always starts the propagation at PI defaults plus this file's AT.
export function applyAigLevelFile(imported, file) {
  const reports = bindReports(imported.model, file);
  const nodes = deriveLevels(imported.model, reports, file);
  const model = { ...imported.model, nodes, hasInputLevelOffsets: nodes.some(node => node.kind === "pi" && node.level > 0) };
  return freezeAig({ ...imported, model, analysis: analyzeAig(model),
    levelFile: { name: file.name, pointCount: reports.size } });
}
