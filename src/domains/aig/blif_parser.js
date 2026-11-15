import { AIG_IMPORT_LIMITS, requireAig } from "./aig_diagnostics.js";

// Preserve declarations and cover rows; no Boolean inference in this parser.
export function parseBlifSource(text, options = {}) {
  const source = { format: "blif", name: options.name };
  requireAig(typeof text === "string", "BLIF source must be text", source);
  requireAig(text.length <= AIG_IMPORT_LIMITS.sourceCharacters, "BLIF source exceeds the 16 MiB import limit", source);
  const declarations = [];
  let pending = "";
  let pendingLine = 0;
  let current = null;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    let part = lines[index].split("#", 1)[0].trim();
    if (!pending) pendingLine = index + 1;
    if (part.endsWith("\\")) { pending += `${part.slice(0, -1)} `; continue; }
    part = `${pending}${part}`.trim();
    pending = "";
    if (!part) continue;
    const fields = part.split(/\s+/);
    const location = { line: pendingLine, column: 1 };
    if (fields[0].startsWith(".")) {
      current = { directive: fields[0], arguments: fields.slice(1), rows: [], ...location };
      declarations.push(current);
      requireAig(declarations.length <= AIG_IMPORT_LIMITS.objects, "BLIF declaration count exceeds the import limit", source, location);
    } else {
      requireAig(current?.directive === ".names", "BLIF cover must follow .names", source, location);
      current.rows.push({ fields, ...location });
    }
  }
  requireAig(!pending, "Unfinished BLIF continuation", source, { line: pendingLine });
  return { format: "blif", declarations };
}
