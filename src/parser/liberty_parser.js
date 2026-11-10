import { createLibertyLexer, LIBERTY_LIMITS } from "./liberty_lexer.js";

const GROUPS = Object.freeze({
  root: new Set(["library"]), library: new Set(["cell", "type"]),
  cell: new Set(["pin", "pg_pin", "bus", "bundle", "ff", "latch", "ff_bank", "latch_bank"]),
  bus: new Set(["pin"]), bundle: new Set(["pin"])
});
const ATTRIBUTES = new Set([
  "direction", "function", "three_state", "clock", "pg_type", "bus_type", "bus_naming_style",
  "base_type", "data_type", "bit_width", "bit_from", "bit_to", "downto", "members",
  "clocked_on", "next_state", "clear", "preset", "enable", "data_in",
  "nom_process", "nom_voltage", "nom_temperature", "time_unit", "voltage_unit"
]);

/** Structural reader. The iterator exposes bounded scheduling points, no DOM or inference. */
export function* parseLibertySteps(text, { name = "library.lib" } = {}) {
  const lexer = createLibertyLexer(text, name);
  const root = { type: "root", groups: [], attributes: Object.create(null) };
  const stack = [{ type: "root", node: root }];
  let statement = null, lastYield = 0, cells = 0, pins = 0;
  const reset = () => { statement = null; };
  const finish = (token) => {
    if (!statement) return;
    if (statement.depth !== 0 || ![":", "=", "("].includes(statement.mode)) lexer.fail("Incomplete statement", statement.start);
    if (statement.name === "include_file") lexer.fail("include_file is not supported; provide a self-contained library", statement.start);
    const parent = stack.at(-1).node;
    if (parent && ATTRIBUTES.has(statement.name)) {
      if (Object.hasOwn(parent.attributes, statement.name)) lexer.fail(`Duplicate attribute ${statement.name}`, statement.start);
      parent.attributes[statement.name] = statement.values.length === 1
        ? statement.values[0] : statement.values.join(" ");
    }
    reset();
  };
  for (;;) {
    const token = lexer.next();
    if (token.kind === "pause") { lastYield = lexer.offset; yield { offset: lexer.offset, total: text.length }; continue; }
    if (lexer.offset - lastYield >= LIBERTY_LIMITS.sliceCharacters) {
      lastYield = lexer.offset;
      yield { offset: lexer.offset, total: text.length };
    }
    if (token.kind === "eof") {
      if (stack.length !== 1 || statement) lexer.fail("Unexpected end of Liberty file", token.start);
      if (!root.groups.length) lexer.fail("No library group found", token.start);
      return { libraries: root.groups, sourceName: name, sizeBytes: lexer.sizeBytes };
    }
    if (token.kind === ";") { finish(token); continue; }
    if (token.kind === "}") {
      if (statement) lexer.fail("Missing semicolon before group end", token.start);
      if (stack.length === 1) lexer.fail("Unexpected group end", token.start);
      const frame = stack.pop();
      if (frame.node) frame.node.span.end = token.end;
      continue;
    }
    if (!statement) {
      if (token.kind !== "word") lexer.fail("Expected attribute or group name", token.start);
      if (token.value === "include_file") lexer.fail("include_file is not supported; provide a self-contained library", token.start);
      statement = { name: token.value, start: token.start, mode: null, depth: 0, values: [], args: [], argument: [], closed: false };
      continue;
    }
    if (!statement.mode) {
      if (![":", "=", "("].includes(token.kind)) lexer.fail("Expected ':', '=' or '('", token.start);
      statement.mode = token.kind;
      if (token.kind === "(") statement.depth = 1;
      continue;
    }
    if (token.kind === "{") {
      if (statement.mode !== "(" || !statement.closed) lexer.fail("Expected closed group arguments", token.start);
      const parent = stack.at(-1);
      const keep = Boolean(parent.node && GROUPS[parent.type]?.has(statement.name));
      if (stack.length >= LIBERTY_LIMITS.maxDepth) lexer.fail("maxDepth exceeded", token.start);
      if (keep && statement.name === "cell") { if (++cells > LIBERTY_LIMITS.maxCells) lexer.fail("maxCells exceeded", token.start); pins = 0; }
      if (keep && ["pin", "pg_pin"].includes(statement.name) && ++pins > LIBERTY_LIMITS.maxPinsPerCell) lexer.fail("maxPinsPerCell exceeded", token.start);
      const node = keep ? { type: statement.name, args: statement.args, attributes: Object.create(null), groups: [], span: { start: statement.start, end: null } } : null;
      if (node) parent.node.groups.push(node);
      stack.push({ type: statement.name, node });
      reset();
      continue;
    }
    const retain = Boolean(stack.at(-1).node && (ATTRIBUTES.has(statement.name) || GROUPS[stack.at(-1).type]?.has(statement.name)));
    if (statement.closed) lexer.fail("Expected '{' or ';' after arguments", token.start);
    if (statement.mode === "(") {
      if (token.kind === "(") statement.depth += 1;
      if (token.kind === ")") {
        statement.depth -= 1;
        if (statement.depth < 0) lexer.fail("Unexpected ')'", token.start);
        if (statement.depth === 0) {
          if (retain && statement.argument.length) statement.args.push(statement.argument.join(" "));
          statement.closed = true;
        }
      }
      if (statement.depth === 1 && token.kind === ",") {
        if (retain) statement.args.push(statement.argument.join(" "));
        statement.argument = [];
      } else if (retain && !statement.closed) statement.argument.push(token.value);
    }
    if (retain && (statement.mode !== "(" || !["(", ")", ","].includes(token.kind))) statement.values.push(token.value);
    if (statement.depth > LIBERTY_LIMITS.maxDepth) lexer.fail("maxDepth exceeded", token.start);
    if (retain && lexer.offset - statement.start.offset > LIBERTY_LIMITS.maxToken) lexer.fail("maxToken statement exceeded", statement.start);
  }
}

export function parseLiberty(text, options) {
  const steps = parseLibertySteps(text, options);
  let result;
  do { result = steps.next(); } while (!result.done);
  return result.value;
}
