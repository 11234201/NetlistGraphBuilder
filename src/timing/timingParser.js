const NUMBER_PATTERN = "[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?";
const PIN_PATTERN = new RegExp(
  `pin\\s*(?:<\\s*([^>\\s]+)\\s*>|([^,\\s]+))\\s*,\\s*at\\s+(${NUMBER_PATTERN})\\s*,\\s*(?:rt|rat)\\s+(${NUMBER_PATTERN})\\s*,\\s*slack\\s+(${NUMBER_PATTERN})`,
  "gi"
);
const INSTANCE_PATTERN = /\binst\s*<([^>]+)>/gi;
const SCOPE_PATTERN = /^\s*(module|instance|inst)\s*(?:<\s*([^>]+)\s*>|:\s*(\S+))/i;
const APPLY_PATTERN = /^\s*apply\s*:\s*(.*?)\s*$/i;
const SNAPSHOT_PATTERN = /(?:^|\s|\[)(global|local)(?:\]|\s|:|$)/i;
const TABLE_ROW_LEADING = new RegExp(
  `^\\s*(input|output)\\s+(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})\\s+(.+?)\\s*$`,
  "i"
);
const TABLE_ROW_TRAILING = new RegExp(
  `^\\s*(.+?)\\s+(input|output)\\s+(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})\\s*$`,
  "i"
);
const DYNAMIC_HEADER_PATTERN = /^\s*(input|output|direction)\s+(.+?)\s*\[(global|local)\]\s*(\S.*)?$/i;

export { annotateGraphTiming } from "./timingAnnotation.js";

export function parseTimingLog(text) {
  const source = String(text || "");
  const table = parseBoundaryTiming(source);
  if (table.scopes.length > 0) {
    return createTimingDataset("boundary-table", table.scopes, table.diagnostics);
  }
  return parseLegacyTiming(source);
}

function parseLegacyTiming(source) {
  const instances = {};
  const records = [];
  const scopes = [];
  const matches = [...source.matchAll(INSTANCE_PATTERN)];

  for (const [index, match] of matches.entries()) {
    const fullPath = match[1].trim();
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const pins = parsePins(source.slice(start, end));
    const summary = summarizePins(pins);
    const instance = getLeafName(fullPath);
    const record = { instance, fullPath, pins, ...summary };
    records.push(record);
    instances[instance] = record;
    scopes.push({
      subject: fullPath,
      scopeKind: "instance",
      apply: null,
      snapshots: { global: Object.values(pins).map((pin) => ({
        direction: null,
        at: pin.at,
        rt: pin.rt,
        slack: pin.slack,
        fullPath: `${fullPath}/${pin.pin}`,
        objectName: pin.pin
      })), local: [] }
    });
  }

  return {
    kind: "locresyn-timing",
    format: "locresyn-legacy",
    scopes,
    diagnostics: [],
    instanceCount: records.length,
    instances,
    records
  };
}

function parseBoundaryTiming(source) {
  const scopes = [];
  const diagnostics = [];
  let scope = null;
  let snapshot = null;
  let tableHeader = null;

  for (const [lineIndex, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^-{3,}$/.test(line)) continue;
    const dynamicHeader = parseDynamicHeader(line);
    if (dynamicHeader) {
      snapshot = dynamicHeader.snapshot;
      tableHeader = dynamicHeader;
      const subject = dynamicHeader.subject;
      if (subject) {
        scope = scopes.find((item) => item.subject === subject) || createScope(subject, "module");
        if (!scopes.includes(scope)) scopes.push(scope);
      }
      continue;
    }
    const scopeMatch = line.match(SCOPE_PATTERN);
    if (scopeMatch) {
      scope = createScope(scopeMatch[2] || scopeMatch[3], scopeMatch[1]);
      scopes.push(scope);
      snapshot = null;
      tableHeader = null;
      continue;
    }
    const applyMatch = line.match(APPLY_PATTERN);
    if (applyMatch) {
      if (!scope) {
        scope = createScope("", "unknown");
        scopes.push(scope);
      }
      scope.apply = applyMatch[1] || "";
      continue;
    }
    const snapshotMatch = line.match(SNAPSHOT_PATTERN);
    const row = parseDynamicRow(line, tableHeader) || parseTableRow(line, snapshotMatch);
    if (row) {
      if (!scope) {
        scope = createScope(inferScopeSubject(row.fullPath), "unknown");
        scopes.push(scope);
      }
      const rowSnapshot = snapshotMatch?.[1]?.toLowerCase() || snapshot || "global";
      scope.snapshots[rowSnapshot].push(row);
      continue;
    }
    if (snapshotMatch) {
      snapshot = snapshotMatch[1].toLowerCase();
      continue;
    }
    if (/\b(direction|at|rat|rt|slack)\b/i.test(line) && !isTableHeader(line)) {
      diagnostics.push({ line: lineIndex + 1, severity: "warning", message: "Unrecognized timing row" });
    }
  }
  return { scopes: scopes.filter(hasScopeRecords), diagnostics };
}

function parseDynamicHeader(line) {
  const match = line.match(DYNAMIC_HEADER_PATTERN);
  if (!match) return null;
  const columns = match[2].trim().split(/\s+/).map((name) => name.toLowerCase());
  if (!columns.includes("at") || !columns.some((name) => name === "rat" || name === "rt") || !columns.includes("slack")) {
    return null;
  }
  return {
    direction: match[1].toLowerCase() === "direction" ? null : match[1].toLowerCase(),
    columns,
    snapshot: match[3].toLowerCase(),
    subject: cleanObjectPath(match[4] || "")
  };
}

function parseDynamicRow(line, header) {
  if (!header) return null;
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < header.columns.length + 1) return null;
  const rawValues = tokens.slice(0, header.columns.length);
  if (!rawValues.every((value) => Number.isFinite(Number(value)))) return null;
  const metrics = {};
  for (const [index, rawName] of header.columns.entries()) {
    const name = rawName === "rat" ? "rt" : rawName;
    metrics[name] = Number(rawValues[index]);
  }
  const fullPath = cleanObjectPath(tokens.slice(header.columns.length).join(" "));
  return {
    direction: header.direction,
    at: metrics.at,
    rt: metrics.rt,
    slack: metrics.slack,
    metrics,
    fullPath,
    objectName: getLeafName(fullPath)
  };
}

function parseTableRow(line, snapshotMatch) {
  const cleaned = snapshotMatch
    ? line.replace(snapshotMatch[0], " ").replace(/\s+/g, " ").trim()
    : line;
  let match = cleaned.match(TABLE_ROW_LEADING);
  if (match) return makeTableRecord(match[1], match[2], match[3], match[4], match[5]);
  match = cleaned.match(TABLE_ROW_TRAILING);
  if (match) return makeTableRecord(match[2], match[3], match[4], match[5], match[1]);
  return null;
}

function makeTableRecord(direction, at, rt, slack, path) {
  const fullPath = cleanObjectPath(path);
  return {
    direction: direction.toLowerCase(),
    at: Number(at),
    rt: Number(rt),
    slack: Number(slack),
    fullPath,
    objectName: getLeafName(fullPath)
  };
}

function createScope(subject, kind) {
  return {
    subject: cleanObjectPath(subject),
    scopeKind: /^module$/i.test(kind) ? "module" : /^inst(?:ance)?$/i.test(kind) ? "instance" : "unknown",
    apply: null,
    snapshots: { global: [], local: [] }
  };
}

function createTimingDataset(format, scopes, diagnostics) {
  for (const scope of scopes) {
    const apply = String(scope.apply ?? "").trim().toLowerCase();
    if (apply && !["none", "no", "false", "0", "global", "yes", "true", "1", "apply", "applied", "local"].includes(apply)) {
      diagnostics.push({ severity: "warning", message: `Unknown Apply value: ${scope.apply}` });
    }
  }
  const records = [];
  const instances = {};
  for (const scope of scopes) {
    const selected = scope.snapshots.global.length ? scope.snapshots.global : scope.snapshots.local;
    const pins = Object.fromEntries(selected.map((item) => [item.objectName, {
      pin: item.objectName, at: item.at, rt: item.rt, slack: item.slack, direction: item.direction
    }]));
    const summary = summarizePins(pins);
    const instance = getLeafName(scope.subject);
    const record = { instance, fullPath: scope.subject, pins, scope, ...summary };
    records.push(record);
    if (scope.scopeKind === "instance" && instance) instances[instance] = record;
  }
  return {
    kind: "timing-dataset",
    format,
    scopes,
    diagnostics,
    instanceCount: scopes.filter((item) => item.scopeKind === "instance").length,
    scopeCount: scopes.length,
    instances,
    records
  };
}

function parsePins(block) {
  const pins = {};
  PIN_PATTERN.lastIndex = 0;
  for (const match of block.matchAll(PIN_PATTERN)) {
    const pin = match[1] || match[2];
    pins[pin] = { pin, at: Number(match[3]), rt: Number(match[4]), slack: Number(match[5]) };
  }
  return pins;
}

function summarizePins(pins) {
  let worstPin = null;
  let worstSlack = null;
  for (const pin of Object.values(pins)) {
    if (worstSlack === null || pin.slack < worstSlack) {
      worstPin = pin.pin;
      worstSlack = pin.slack;
    }
  }
  return { worstPin, worstSlack };
}

function getLeafName(value) {
  const parts = String(value || "").split(/[/.]/);
  return parts[parts.length - 1] || String(value || "");
}

function cleanObjectPath(value) {
  return String(value || "").trim().replace(/^<|>$/g, "").replace(/,$/, "");
}

function inferScopeSubject(path) {
  const parts = String(path || "").split(/[/.]/);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

function hasScopeRecords(scope) {
  return scope.snapshots.global.length > 0 || scope.snapshots.local.length > 0;
}

function isTableHeader(line) {
  return /direction/i.test(line) && /\bat\b/i.test(line) && /\b(?:rat|rt)\b/i.test(line) && /slack/i.test(line);
}
