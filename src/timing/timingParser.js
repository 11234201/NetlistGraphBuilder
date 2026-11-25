import { findLastUnescapedSlash } from "./timing_names.js";
export { annotateGraphTiming } from "./timingAnnotation.js";

const DEFAULT_COLUMNS = Object.freeze([
  "point",
  "at",
  "rt",
  "slack",
  "delay",
  "slew",
  "edge",
  "kind"
]);

const COLUMN_ALIASES = new Map([
  ["point", "point"],
  ["name", "point"],
  ["object", "point"],
  ["pin", "point"],
  ["path", "point"],
  ["node", "point"],
  ["at", "at"],
  ["arrival", "at"],
  ["rt", "rt"],
  ["rat", "rt"],
  ["required", "rt"],
  ["slack", "slack"],
  ["delay", "delay"],
  ["incr", "delay"],
  ["incremental", "delay"],
  ["slew", "slew"],
  ["trans", "slew"],
  ["transition", "slew"],
  ["edge", "edge"],
  ["rf", "edge"],
  ["pol", "edge"],
  ["polarity", "edge"],
  ["kind", "kind"],
  ["type", "kind"]
]);

const NUMERIC_COLUMNS = new Set(["at", "rt", "slack", "delay", "slew"]);
const NULL_TOKENS = new Set(["", "-", "na", "n/a", "null", "*", "none", "unconstrained", "inf", "-inf"]);
const NUMBER_REGEX = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const VALID_STAGES = new Set(["pre_map", "post_map", "post_layout"]);
const VALID_UNITS = new Set(["ns", "ps"]);
const VALID_KINDS = new Set(["port", "pin", "net"]);

export function parseTimingLog(text, { onParseError } = {}) {
  const source = String(text || "");
  // Preserve original line numbers and columns for JSON.parse diagnostics.
  const prefix = /^(?:[ \t]*(?:(?:#|\/\/)[^\r\n]*)?\r?\n)*[ \t\r\n]*/.exec(source)[0];
  if (source[prefix.length] === "{") {
    return parseTimingJson(prefix.replace(/[^\r\n]/g, " ") + source.slice(prefix.length), onParseError);
  }
  return parseTimingTabular(source);
}

function parseTimingTabular(source) {
  const records = [];
  const diagnostics = [];
  let defaultModule = null;
  let currentModule = null;
  let stage = "post_map";
  let currentUnit = "ns";
  let datasetUnit = null;
  let activeColumns = DEFAULT_COLUMNS;
  let headerSeen = false;
  let directiveSeen = false;

  for (const [lineIndex, rawLine] of source.split(/\r?\n/).entries()) {
    const line = stripInlineComment(rawLine.trim());
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    if (/^[-=]{3,}$/.test(line)) continue;

    if (line.startsWith("@")) {
      directiveSeen = true;
      const directiveMatch = line.match(/^@([A-Za-z_][\w-]*)(?:\s+(.*))?$/);
      if (!directiveMatch) {
        diagnostics.push({ line: lineIndex + 1, severity: "warning", code: "invalid-directive", message: `Unrecognized directive: ${line}` });
        continue;
      }
      const key = directiveMatch[1].toLowerCase();
      const value = unquoteToken((directiveMatch[2] || "").trim());
      if (key === "module") {
        currentModule = cleanPointIdentifier(value) || null;
        if (!defaultModule && currentModule) defaultModule = currentModule;
      } else if (key === "stage") {
        stage = normalizeStage(value, diagnostics, lineIndex + 1);
      } else if (key === "unit") {
        currentUnit = normalizeUnit(value, diagnostics, lineIndex + 1, currentModule);
      } else {
        diagnostics.push({ line: lineIndex + 1, severity: "warning", code: "unknown-directive", message: `Unknown timing directive @${key}` });
      }
      continue;
    }

    const tokens = tokenizeTimingLine(line, headerSeen ? activeColumns.length : 0);
    if (tokens.length === 0) continue;

    const headerColumns = detectHeaderColumns(tokens);
    if (headerColumns) {
      activeColumns = headerColumns;
      headerSeen = true;
      continue;
    }

    const rowResult = parseTabularRow(tokens, activeColumns, {
      line: lineIndex + 1,
      module: currentModule,
      contextual: headerSeen || directiveSeen
    });
    if (rowResult.record) {
      datasetUnit ??= currentUnit;
      convertTimingMetrics(rowResult.record, currentUnit, datasetUnit);
      records.push(rowResult.record);
    } else if (rowResult.diagnostic) {
      diagnostics.push({ ...rowResult.diagnostic, module: currentModule });
    }
  }

  return buildTimingDataset({
    format: "tabular",
    module: defaultModule,
    stage,
    unit: datasetUnit || currentUnit,
    records,
    diagnostics
  });
}

function parseTimingJson(source, onParseError) {
  const diagnostics = [];
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    onParseError?.(error);
    const location = error.message.match(/line (\d+) column (\d+)/i);
    const offset = Number(error.message.match(/position (\d+)/i)?.[1] ?? source.length);
    const prefix = location ? null : source.slice(0, offset).split("\n");
    diagnostics.push({ line: location ? Number(location[1]) : prefix.length,
      column: location ? Number(location[2]) : prefix.at(-1).length + 1,
      severity: "error", code: "invalid-json", message: `Invalid timing JSON: ${error.message}` });
    return buildTimingDataset({ format: "json", module: null, stage: "post_map", unit: "ns", records: [], diagnostics });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    diagnostics.push({ line: 1, severity: "error", code: "invalid-json-root", message: "Timing JSON root must be an object" });
    return buildTimingDataset({ format: "json", module: null, stage: "post_map", unit: "ns", records: [], diagnostics });
  }

  const stage = parsed.stage !== undefined ? normalizeStage(parsed.stage, diagnostics, 1) : "post_map";
  const unit = parsed.unit !== undefined ? normalizeUnit(parsed.unit, diagnostics, 1) : "ns";
  const topModule = parsed.module ? cleanPointIdentifier(String(parsed.module)) : null;
  const records = [];

  if (Object.hasOwn(parsed, "points")) {
    extractJsonPoints(parsed.points, topModule, records, diagnostics);
  }

  if (parsed.modules && typeof parsed.modules === "object" && !Array.isArray(parsed.modules)) {
    for (const [modKey, modValue] of Object.entries(parsed.modules)) {
      const modName = cleanPointIdentifier(modKey) || topModule;
      const pointsObj = modValue && Object.hasOwn(modValue, "points") ? modValue.points : modValue;
      extractJsonPoints(pointsObj, modName, records, diagnostics);
    }
  }

  return buildTimingDataset({
    format: "json",
    module: topModule || (records[0]?.module ?? null),
    stage,
    unit,
    records,
    diagnostics
  });
}

function extractJsonPoints(pointsObj, moduleName, records, diagnostics) {
  if (!pointsObj || typeof pointsObj !== "object" || Array.isArray(pointsObj)) {
    diagnostics.push({ severity: "warning", code: "invalid-points", module: moduleName,
      message: "Timing points must be an object keyed by point name" });
    return;
  }
  for (const [rawPoint, rawValue] of Object.entries(pointsObj)) {
    const point = cleanPointIdentifier(rawPoint);
    if (!point) continue;
    const pointModule = rawValue?.module ? cleanPointIdentifier(String(rawValue.module)) : moduleName;
    const numeric = (value, field) => parseJsonNumeric(value, diagnostics, point, field, pointModule);

    if (Array.isArray(rawValue)) {
      const at = numeric(rawValue[0], "at");
      const rt = numeric(rawValue[1], "rt");
      const slack = numeric(rawValue[2], "slack");
      const delay = numeric(rawValue[3], "delay");
      const slew = numeric(rawValue[4], "slew");
      const edge = rawValue[5] !== undefined ? normalizeEdge(rawValue[5]) : null;
      const kind = rawValue[6] !== undefined ? normalizeKind(rawValue[6]) : null;
      if (at.invalid || rt.invalid || slack.invalid || delay.invalid || slew.invalid) continue;
      records.push(createTimingPointRecord({
        point,
        module: moduleName,
        kind,
        at: at.value,
        rt: rt.value,
        slack: slack.value,
        delay: delay.value,
        slew: slew.value,
        edge,
        line: null
      }));
      continue;
    }

    if (rawValue && typeof rawValue === "object") {
      const at = numeric(rawValue.at ?? rawValue.arrival, "at");
      const rt = numeric(rawValue.rt ?? rawValue.rat ?? rawValue.required, "rt");
      const slack = numeric(rawValue.slack, "slack");
      const delay = numeric(rawValue.delay ?? rawValue.incr ?? rawValue.incremental, "delay");
      const slew = numeric(rawValue.slew ?? rawValue.trans ?? rawValue.transition, "slew");
      if (at.invalid || rt.invalid || slack.invalid || delay.invalid || slew.invalid) continue;
      records.push(createTimingPointRecord({
        point,
        module: pointModule,
        kind: normalizeKind(rawValue.kind ?? rawValue.type),
        at: at.value,
        rt: rt.value,
        slack: slack.value,
        delay: delay.value,
        slew: slew.value,
        edge: normalizeEdge(rawValue.edge ?? rawValue.rf ?? rawValue.pol),
        line: null
      }));
      continue;
    }

    diagnostics.push({
      line: null,
      severity: "warning",
      code: "invalid-point", point, module: pointModule,
      message: `Invalid timing entry for '${point}': expected array or object`
    });
  }
}

function parseJsonNumeric(value, diagnostics, point, field, module) {
  if (value === undefined || value === null) return { value: null, invalid: false };
  if (typeof value === "number") {
    if (Number.isFinite(value)) return { value, invalid: false };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (NULL_TOKENS.has(trimmed.toLowerCase())) return { value: null, invalid: false };
    if (NUMBER_REGEX.test(trimmed) && Number.isFinite(Number(trimmed))) return { value: Number(trimmed), invalid: false };
  }
  diagnostics.push({
    line: null,
    severity: "warning",
    code: "invalid-number", point, field, module,
    message: `Invalid numeric value for '${point}.${field}': ${String(value)}`
  });
  return { value: null, invalid: true };
}

function detectHeaderColumns(tokens) {
  if (tokens.length < 2) return null;
  const firstMapped = COLUMN_ALIASES.get(tokens[0].toLowerCase());
  if (firstMapped !== "point") return null;

  const mapped = tokens.map((token) => COLUMN_ALIASES.get(token.toLowerCase()) || token.toLowerCase());
  const hasKnownMetric = mapped.slice(1).some((col) => NUMERIC_COLUMNS.has(col) || col === "edge" || col === "kind");
  if (!hasKnownMetric) return null;
  if (tokens.slice(1).some((token) => NUMBER_REGEX.test(token))) return null;
  return mapped;
}

function parseTabularRow(tokens, columns, { line, module, contextual }) {
  if (tokens.length < 2) {
    return contextual
      ? { record: null, diagnostic: { line, severity: "warning", code: "incomplete-row", point: cleanPointIdentifier(tokens[0]), message: "Incomplete timing row" } }
      : { record: null, diagnostic: null };
  }

  const values = {
    point: null,
    at: null,
    rt: null,
    slack: null,
    delay: null,
    slew: null,
    edge: null,
    kind: null
  };

  let finiteNumericCount = 0;
  let explicitNullCount = 0;

  for (let index = 0; index < tokens.length && index < columns.length; index += 1) {
    const column = columns[index];
    const rawToken = tokens[index];

    if (column === "point") {
      values.point = cleanPointIdentifier(rawToken);
      continue;
    }

    if (NUMERIC_COLUMNS.has(column)) {
      const lower = rawToken.toLowerCase();
      if (NULL_TOKENS.has(lower)) {
        values[column] = null;
        explicitNullCount += 1;
        continue;
      }
      if (!NUMBER_REGEX.test(rawToken) || !Number.isFinite(Number(rawToken))) {
        return {
          record: null,
          diagnostic: contextual || values.point?.includes("/") || tokens.slice(1).some((token) => NUMBER_REGEX.test(token))
            ? { line, severity: "warning", code: "invalid-number", point: values.point, field: column,
                message: `Invalid numeric value '${rawToken}' in column '${column}'` }
            : null
        };
      }
      values[column] = Number(rawToken);
      finiteNumericCount += 1;
      continue;
    }

    if (column === "edge") {
      values.edge = normalizeEdge(rawToken);
      continue;
    }

    if (column === "kind") {
      values.kind = normalizeKind(rawToken);
    }
  }

  if (!values.point) {
    return { record: null, diagnostic: null };
  }

  if (finiteNumericCount === 0 && !(contextual && explicitNullCount >= 2)) {
    return {
      record: null,
      diagnostic: contextual
        ? { line, severity: "warning", code: "missing-metrics", point: values.point, message: `Row for '${values.point}' has no valid timing metrics` }
        : null
    };
  }

  return {
    record: createTimingPointRecord({
      point: values.point,
      module,
      kind: values.kind,
      at: values.at,
      rt: values.rt,
      slack: values.slack,
      delay: values.delay,
      slew: values.slew,
      edge: values.edge,
      line
    }),
    diagnostic: null
  };
}

function createTimingPointRecord({ point, module, kind, at, rt, slack, delay, slew, edge, line }) {
  let resolvedSlack = slack;
  let slackDerived = false;
  if (resolvedSlack === null && Number.isFinite(at) && Number.isFinite(rt)) {
    resolvedSlack = roundTiming(rt - at);
    slackDerived = true;
  }
  return {
    point,
    module: module || null,
    kind: kind || null,
    at: Number.isFinite(at) ? at : null,
    rt: Number.isFinite(rt) ? rt : null,
    slack: Number.isFinite(resolvedSlack) ? resolvedSlack : null,
    slackDerived,
    delay: Number.isFinite(delay) ? delay : null,
    slew: Number.isFinite(slew) ? slew : null,
    edge: edge || null,
    line: line ?? null
  };
}

function buildTimingDataset({ format, module, stage, unit, records, diagnostics }) {
  const scopes = Object.create(null);
  const distinctSubjects = new Set();

  for (const record of records) {
    const scopeKey = record.module || "__default__";
    if (!scopes[scopeKey]) scopes[scopeKey] = [];
    scopes[scopeKey].push(record);
    distinctSubjects.add(`${scopeKey}::${getSubjectKey(record.point, record.kind)}`);
  }

  return {
    version: "1.0",
    kind: "timing-dataset",
    format,
    module: module || null,
    stage,
    unit,
    records,
    scopes,
    recordCount: records.length,
    instanceCount: distinctSubjects.size,
    scopeCount: Object.keys(scopes).length,
    diagnostics
  };
}

export function mergeTimingDatasets(datasets = []) {
  const valid = (Array.isArray(datasets) ? datasets : [datasets])
    .filter((dataset) => dataset && Array.isArray(dataset.records));
  if (valid.length === 0) return null;
  const targetUnit = valid.find(({ unit }) => !unit || VALID_UNITS.has(unit))?.unit || "ns";

  const records = [];
  const diagnostics = [];
  const formats = new Set();
  const stages = new Set();
  const modules = new Set();

  for (const dataset of valid) {
    const unit = dataset.unit || targetUnit;
    const mixed = unit !== targetUnit;
    if (!VALID_UNITS.has(unit)) {
      diagnostics.push({ severity: "error", code: "incompatible-timing-units", fileName: dataset.fileName,
        units: [targetUnit, unit], message: "Cannot convert " + unit + " to " + targetUnit });
      continue;
    }
    if (dataset.format) formats.add(dataset.format);
    if (dataset.stage) stages.add(dataset.stage);
    for (const warning of dataset.diagnostics || []) {
      diagnostics.push(dataset.fileName && !warning.fileName ? { ...warning, fileName: dataset.fileName } : warning);
    }
    for (const record of dataset.records) {
      const moduleName = record.module === undefined ? dataset.module || null : record.module;
      if (moduleName) modules.add(moduleName);
      const fileName = record.fileName || dataset.fileName;
      if (mixed || (moduleName && !record.module) || (fileName && !record.fileName)) {
        const next = { ...record, module: moduleName, ...(fileName ? { fileName } : {}) };
        convertTimingMetrics(next, unit, targetUnit);
        records.push(next);
      } else {
        records.push(record);
      }
    }
  }

  const result = buildTimingDataset({
    format: formats.size === 1 ? [...formats][0] : "merged",
    module: modules.size === 1 ? [...modules][0] : null,
    stage: stages.size === 1 ? [...stages][0] : ([...stages].join(", ") || null),
    unit: targetUnit,
    records,
    diagnostics
  });
  return valid.length === 1 ? { ...valid[0], ...result } : result;
}

function convertTimingMetrics(record, from, to) {
  if (from === to) return;
  const scale = from === "ps" ? 0.001 : 1000;
  for (const metric of NUMERIC_COLUMNS) {
    if (Number.isFinite(record[metric])) record[metric] = roundTiming(record[metric] * scale);
  }
}

function getSubjectKey(point, kind) {
  if (kind === "port" || kind === "net") return point;
  const slashIndex = findLastUnescapedSlash(point);
  if (slashIndex > 0) {
    return point.slice(0, slashIndex);
  }
  return point;
}

export function tokenizeTimingLine(line, columnCount = 0) {
  const { commas } = scanTimingLine(line, columnCount);
  if (commas.length) {
    let start = 0;
    return [...commas, line.length].map((end) => {
      const field = unquoteToken(line.slice(start, end));
      start = end + 1;
      return field;
    });
  }
  const rawTokens = [];
  const tokenPattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  for (const match of line.matchAll(tokenPattern)) {
    rawTokens.push(match[1] ?? match[2] ?? match[3]);
  }
  const coalesced = [];
  for (let index = 0; index < rawTokens.length; index += 1) {
    let current = rawTokens[index];
    while (
      index + 1 < rawTokens.length &&
      current.includes("\\") &&
      rawTokens[index + 1].startsWith("/")
    ) {
      current = `${current}${rawTokens[index + 1]}`;
      index += 1;
    }
    coalesced.push(current);
  }
  return coalesced;
}

function scanTimingLine(line, columnCount = 0) {
  const commas = [];
  const ambiguousCommas = [];
  let comment = line.length;
  let quote = "";
  let backslashes = 0;
  for (let index = 0; index < line.length; index++) {
    const c = line[index];
    if (quote) {
      if (c === quote && backslashes % 2 === 0) quote = "";
      backslashes = c === "\\" ? backslashes + 1 : 0;
    } else if (c === "\\" && (index === 0 || /[\s,/]/.test(line[index - 1]))) {
      index = escapedTimingNameEnd(line, index, ambiguousCommas) - 1;
    } else if (c === '"' || c === "'") {
      quote = c;
      backslashes = 0;
    } else if (c === "#" || (c === "/" && line[index + 1] === "/")) {
      comment = index;
      break;
    } else if (c === ",") commas.push(index);
  }
  const missing = columnCount - commas.length - 1;
  if (missing > 0 && missing <= ambiguousCommas.length) {
    return { commas: commas.concat(ambiguousCommas.slice(-missing)).sort((a, b) => a - b), comment };
  }
  return { commas, comment };
}

function escapedTimingNameEnd(line, start, ambiguousCommas) {
  let end = start + 1;
  let firstComma = -1;
  while (end < line.length && !/\s/.test(line[end])) {
    if (line[end] === "," && firstComma < 0) firstComma = end;
    end++;
  }
  if (firstComma < 0) return end;
  let next = end;
  while (next < line.length && /\s/.test(line[next])) next++;
  // A whitespace-terminated Verilog name can contain commas before a pin path or CSV delimiter.
  if (line[next] === ",") {
    // Resolve delimiters before padded numeric fields against the declared CSV column count.
    for (let index = firstComma; index < end; index++) {
      if (line[index] === ",") ambiguousCommas.push(index);
    }
    return end;
  }
  if (line[next] === "[" || (line[next] === "/" && !line.startsWith("//", next))) return end;
  if (next === line.length || line[end - 1] === "," || line[next] === "#" || line.startsWith("//", next)) return firstComma;
  return end;
}

function unquoteToken(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function stripInlineComment(line) {
  return line.slice(0, scanTimingLine(line).comment).trimEnd();
}

function cleanPointIdentifier(value) {
  return unquoteToken(value)
    .replace(/\\(\S+)\s+\//g, "\\$1/")
    .replace(/\s+\[/g, "[")
    .trim();
}

function normalizeStage(value, diagnostics, line) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  if (VALID_STAGES.has(normalized)) return normalized;
  diagnostics?.push({
    line,
    severity: "warning",
    code: "unknown-stage",
    message: `Unknown @stage '${value}', defaulting to 'post_map'`
  });
  return "post_map";
}

function normalizeUnit(value, diagnostics, line, module = null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (VALID_UNITS.has(normalized)) return normalized;
  diagnostics?.push({
    line,
    severity: "warning",
    code: "unknown-unit",
    module,
    message: `Unknown @unit '${value}', unsupported time unit`
  });
  return "ns";
}

function normalizeEdge(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  if (NULL_TOKENS.has(normalized)) return null;
  if (["r", "rise", "rising", "pos", "posedge", "^", "+"].includes(normalized)) return "r";
  if (["f", "fall", "falling", "neg", "negedge", "v"].includes(normalized)) return "f";
  return null;
}

function normalizeKind(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  if (VALID_KINDS.has(normalized)) return normalized;
  return null;
}

function roundTiming(value) {
  return Number(Number(value).toFixed(6));
}
