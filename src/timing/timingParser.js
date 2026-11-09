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

export function parseTimingLog(text) {
  const source = String(text || "");
  if (startsWithJsonObject(source)) {
    return parseTimingJson(source);
  }
  return parseTimingTabular(source);
}

function startsWithJsonObject(source) {
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    return line.startsWith("{");
  }
  return false;
}

function parseTimingTabular(source) {
  const records = [];
  const diagnostics = [];
  let defaultModule = null;
  let currentModule = null;
  let stage = "post_map";
  let unit = "ns";
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
        diagnostics.push({ line: lineIndex + 1, severity: "warning", message: `Unrecognized directive: ${line}` });
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
        unit = normalizeUnit(value, diagnostics, lineIndex + 1);
      } else {
        diagnostics.push({ line: lineIndex + 1, severity: "warning", message: `Unknown timing directive @${key}` });
      }
      continue;
    }

    const tokens = tokenizeTimingLine(line);
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
      records.push(rowResult.record);
    } else if (rowResult.diagnostic) {
      diagnostics.push(rowResult.diagnostic);
    }
  }

  return buildTimingDataset({
    format: "tabular",
    module: defaultModule,
    stage,
    unit,
    records,
    diagnostics
  });
}

function parseTimingJson(source) {
  const diagnostics = [];
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    diagnostics.push({ line: 1, severity: "error", message: `Invalid timing JSON: ${error.message}` });
    return buildTimingDataset({ format: "json", module: null, stage: "post_map", unit: "ns", records: [], diagnostics });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    diagnostics.push({ line: 1, severity: "error", message: "Timing JSON root must be an object" });
    return buildTimingDataset({ format: "json", module: null, stage: "post_map", unit: "ns", records: [], diagnostics });
  }

  const stage = parsed.stage !== undefined ? normalizeStage(parsed.stage, diagnostics, 1) : "post_map";
  const unit = parsed.unit !== undefined ? normalizeUnit(parsed.unit, diagnostics, 1) : "ns";
  const topModule = parsed.module ? cleanPointIdentifier(String(parsed.module)) : null;
  const records = [];

  if (parsed.points && typeof parsed.points === "object" && !Array.isArray(parsed.points)) {
    extractJsonPoints(parsed.points, topModule, records, diagnostics);
  }

  if (parsed.modules && typeof parsed.modules === "object" && !Array.isArray(parsed.modules)) {
    for (const [modKey, modValue] of Object.entries(parsed.modules)) {
      const modName = cleanPointIdentifier(modKey) || topModule;
      const pointsObj = modValue?.points && typeof modValue.points === "object" ? modValue.points : modValue;
      if (pointsObj && typeof pointsObj === "object" && !Array.isArray(pointsObj)) {
        extractJsonPoints(pointsObj, modName, records, diagnostics);
      }
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
  for (const [rawPoint, rawValue] of Object.entries(pointsObj)) {
    const point = cleanPointIdentifier(rawPoint);
    if (!point) continue;

    if (Array.isArray(rawValue)) {
      const at = parseJsonNumeric(rawValue[0], diagnostics, point, "at");
      const rt = parseJsonNumeric(rawValue[1], diagnostics, point, "rt");
      const slack = parseJsonNumeric(rawValue[2], diagnostics, point, "slack");
      const delay = parseJsonNumeric(rawValue[3], diagnostics, point, "delay");
      const slew = parseJsonNumeric(rawValue[4], diagnostics, point, "slew");
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
      const at = parseJsonNumeric(rawValue.at ?? rawValue.arrival, diagnostics, point, "at");
      const rt = parseJsonNumeric(rawValue.rt ?? rawValue.rat ?? rawValue.required, diagnostics, point, "rt");
      const slack = parseJsonNumeric(rawValue.slack, diagnostics, point, "slack");
      const delay = parseJsonNumeric(rawValue.delay ?? rawValue.incr ?? rawValue.incremental, diagnostics, point, "delay");
      const slew = parseJsonNumeric(rawValue.slew ?? rawValue.trans ?? rawValue.transition, diagnostics, point, "slew");
      if (at.invalid || rt.invalid || slack.invalid || delay.invalid || slew.invalid) continue;
      records.push(createTimingPointRecord({
        point,
        module: rawValue.module ? cleanPointIdentifier(String(rawValue.module)) : moduleName,
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
      message: `Invalid timing entry for '${point}': expected array or object`
    });
  }
}

function parseJsonNumeric(value, diagnostics, point, field) {
  if (value === undefined || value === null) return { value: null, invalid: false };
  if (typeof value === "number") {
    if (Number.isFinite(value)) return { value, invalid: false };
    return { value: null, invalid: false };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (NULL_TOKENS.has(trimmed.toLowerCase())) return { value: null, invalid: false };
    if (NUMBER_REGEX.test(trimmed)) return { value: Number(trimmed), invalid: false };
  }
  diagnostics.push({
    line: null,
    severity: "warning",
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
      ? { record: null, diagnostic: { line, severity: "warning", message: "Incomplete timing row" } }
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
      if (!NUMBER_REGEX.test(rawToken)) {
        return {
          record: null,
          diagnostic: contextual
            ? { line, severity: "warning", message: `Invalid numeric value '${rawToken}' in column '${column}'` }
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
        ? { line, severity: "warning", message: `Row for '${values.point}' has no valid timing metrics` }
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
  const scopes = {};
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

function getSubjectKey(point, kind) {
  if (kind === "port" || kind === "net") return point;
  const slashIndex = point.lastIndexOf("/");
  if (slashIndex > 0 && !point.startsWith("\\")) {
    return point.slice(0, slashIndex);
  }
  if (slashIndex > 0 && point.startsWith("\\")) {
    return point.slice(0, slashIndex);
  }
  return point;
}

export function tokenizeTimingLine(line) {
  if (hasUnquotedComma(line)) {
    return splitCsvLine(line);
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

function hasUnquotedComma(line) {
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"" && line[index - 1] !== "\\") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      return true;
    }
  }
  return false;
}

function splitCsvLine(line) {
  const tokens = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"" && line[index - 1] !== "\\") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      tokens.push(unquoteToken(current.trim()));
      current = "";
    } else {
      current += char;
    }
  }
  tokens.push(unquoteToken(current.trim()));
  return tokens;
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
  let inQuotes = false;
  let quoteChar = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== "\\") {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuotes = false;
      }
    } else if (!inQuotes) {
      if (char === "#") {
        return line.slice(0, index).trim();
      }
      if (char === "/" && line[index + 1] === "/") {
        return line.slice(0, index).trim();
      }
    }
  }
  return line;
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
    message: `Unknown @stage '${value}', defaulting to 'post_map'`
  });
  return "post_map";
}

function normalizeUnit(value, diagnostics, line) {
  const normalized = String(value || "").trim().toLowerCase();
  if (VALID_UNITS.has(normalized)) return normalized;
  diagnostics?.push({
    line,
    severity: "warning",
    message: `Unknown @unit '${value}', defaulting to 'ns'`
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
