import { AIG_IMPORT_LIMITS, aigError } from "./aig_diagnostics.js";

const columns = new Map([
  ["point", "point"], ["kind", "kind"],
  ["at_level", "at"], ["rt_level", "rt"], ["slack_level", "slack"],
  ["at", "at"], ["rt", "rt"], ["slack", "slack"]
]);
const shorthand = ["point", "at"];
const kinds = new Set(["pi", "po", "and", "constant"]);

// Scan one physical line at a time. A quoted name is a single field in
// either notation, including CSV doubled quotes and literal whitespace.
function splitFields(line, index, file) {
  const fields = [];
  const token = /"((?:[^"]|"")*)"|([^\s,"]+)/y;
  const separator = /[ \t]*,[ \t]*|[ \t]+/y;
  let offset = line.search(/\S/);
  while (offset < line.length) {
    token.lastIndex = offset;
    const match = token.exec(line);
    const location = { line: index, column: offset + 1 };
    if (!match || fields.length === 5) throw aigError("Expected at most five nonempty Level fields", file, location, "aig.level-row");
    fields.push({ value: match[2] ?? match[1].replace(/""/g, '"'), column: offset + 1 });
    offset = token.lastIndex;
    if (offset === line.length) break;
    separator.lastIndex = offset;
    if (!separator.exec(line) || separator.lastIndex === line.length)
      throw aigError("Expected another field after the separator, or end of line after the value", file,
        { line: index, column: offset + 1 }, "aig.level-row");
    offset = separator.lastIndex;
  }
  return fields;
}

function readHeader(fields, file, line) {
  // A PI may itself be named "point", "kind" or "at_level".
  if (fields.length === 2 && /^[-+]?\d+$|^-$/.test(fields[1].value)) return null;
  if (!fields.some(({ value }) => columns.has(value))) return null;
  const seen = new Set();
  const names = fields.map(({ value, column }) => {
    const name = columns.get(value);
    if (!name || seen.has(name))
      throw aigError(`Unknown or repeated Level column '${value.slice(0, 100)}'`, file, { line, column }, "aig.level-header");
    seen.add(name);
    return name;
  });
  if (!seen.has("point") || !["at", "rt", "slack"].some(name => seen.has(name)))
    throw aigError("Level header requires point and at least one metric", file, { line, column: 1 }, "aig.level-header");
  return names;
}

export function* readAigLevelRows(file) {
  const { text } = file;
  if (typeof text !== "string" || text.length > AIG_IMPORT_LIMITS.sourceCharacters)
    throw aigError("Level input must be text within the AIG source size limit", file, {}, "aig.level-limit");
  let header, records = 0, offset = 0, line = 0;
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline;
    const raw = text.slice(offset, end).trimEnd();
    offset = end + 1;
    line++;
    if (!raw.trimStart() || raw.trimStart().startsWith("#")) continue;
    const fields = splitFields(raw, line, file);
    if (!header) {
      header = readHeader(fields, file, line);
      if (header) continue;
      header = shorthand;
    }
    const location = { line, column: fields[0].column };
    if (fields.length !== header.length)
      throw aigError(`Expected ${header.length} Level fields, found ${fields.length}`, file, location, "aig.level-row");
    const row = { ...location, inputOnly: header === shorthand, kind: header === shorthand ? "pi" : null, metrics: {} };
    for (const [index, name] of header.entries()) {
      const { value, column } = fields[index];
      if (name === "point") {
        if (!value) throw aigError("Expected an AIG object name", file, { line, column }, "aig.level-row");
        row.point = value;
        row.column = column;
      } else if (name === "kind") {
        if (!kinds.has(value) && value !== "-")
          throw aigError("Expected Level kind pi, po, and or constant", file, { line, column }, "aig.level-row");
        row.kind = value === "-" ? null : value;
      } else if (value !== "-") {
        const number = Number(value);
        if (!/^[+-]?\d+$/.test(value) || !Number.isSafeInteger(number) || (name === "at" && number < 0))
          throw aigError(`Expected ${name === "at" ? "a nonnegative" : "a signed"} exact decimal integer for ${name}_level`, file,
            { line, column }, "aig.level-value");
        row.metrics[name] = number || 0;
      }
    }
    if (!Object.keys(row.metrics).length) throw aigError("Expected at least one Level value", file, location, "aig.level-row");
    records++;
    yield row;
  }
  if (!records) throw aigError("Level file contains no data rows", file, { line: line || 1, column: 1 }, "aig.level-row");
}
