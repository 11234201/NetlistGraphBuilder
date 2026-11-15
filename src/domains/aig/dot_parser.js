import { AIG_IMPORT_LIMITS, aigError, requireAig } from "./aig_diagnostics.js";

// This is a structural parser for directed DOT, not an edge-matching regex.
// ABC semantics (shapes, polarity, helper removal) belong to the adapter.
export function parseDotSource(text, options = {}) {
  const source = { format: "abc-dot", name: options.name };
  requireAig(typeof text === "string", "DOT source must be text", source);
  requireAig(text.length <= AIG_IMPORT_LIMITS.sourceCharacters, "DOT source exceeds the 16 MiB import limit", source);
  const tokens = tokenize(text, source);
  let position = 0;
  const nodes = new Map();
  const edges = [];
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  // Quoted IDs can contain punctuation or reserved words. Only unquoted
  // tokens participate in the grammar; DOT keywords are case insensitive.
  const matches = (value, token) => Boolean(token && !token.quoted
    && (token.kind === "id" ? token.value.toLowerCase() : token.value) === value);
  const at = (value) => matches(value, peek());
  const accept = (value) => at(value) ? take() : null;
  const expect = (value) => {
    const token = take();
    requireAig(matches(value, token), `Expected '${value}'`, source, token || tokens.at(-1));
    return token;
  };
  const identifier = () => {
    const token = take();
    requireAig(token?.kind === "id", "Expected a DOT identifier or quoted string", source, token || tokens.at(-1));
    let value = token.value;
    while (accept("+")) {
      const continuation = take();
      requireAig(token.quoted && continuation?.quoted, "DOT '+' only joins quoted strings", source, continuation);
      value += continuation.value;
    }
    return { ...token, value };
  };
  const attributes = () => {
    const result = Object.create(null);
    while (accept("[")) {
      while (peek() && !at("]")) {
        if (accept(",") || accept(";")) continue;
        const key = identifier();
        expect("=");
        result[key.value] = identifier().value;
      }
      expect("]");
    }
    return result;
  };
  const addNode = (token, defaults) => {
    if (!nodes.has(token.value)) {
      requireAig(nodes.size < AIG_IMPORT_LIMITS.objects, "DOT object count exceeds the import limit", source, token);
      nodes.set(token.value, { id: token.value, attributes: { ...defaults }, line: token.line, column: token.column });
    }
    return token.value;
  };
  function endpoint(scope, depth) {
    if (at("{") || at("subgraph")) return group(scope, depth + 1);
    const token = identifier();
    requireAig(!at(":"), "Node ports are outside the ABC AIG DOT format", source, peek());
    return [addNode(token, scope.node)];
  }
  function group(parent, depth) {
    requireAig(depth <= AIG_IMPORT_LIMITS.nesting, "DOT subgraph nesting exceeds the import limit", source, peek());
    if (accept("subgraph") && !at("{")) identifier();
    expect("{");
    const scope = { node: { ...parent.node }, edge: { ...parent.edge } };
    const members = new Set();
    while (peek() && !at("}")) {
      if (accept(";") || accept(",")) continue;
      const first = peek();
      const attributeScope = ["graph", "node", "edge"].find((value) => matches(value, first));
      if (attributeScope && matches("[", tokens[position + 1])) {
        take();
        const values = attributes();
        if (attributeScope !== "graph") Object.assign(scope[attributeScope], values);
        continue;
      }
      let afterIdentifier = position + 1;
      while (matches("+", tokens[afterIdentifier])) afterIdentifier += 2;
      if (first.kind === "id" && matches("=", tokens[afterIdentifier])) {
        identifier(); expect("="); identifier();
        continue;
      }
      let previous = endpoint(scope, depth);
      previous.forEach((id) => members.add(id));
      if (at("->")) {
        const additions = [];
        while (accept("->")) {
          const next = endpoint(scope, depth);
          next.forEach((id) => members.add(id));
          for (const tail of previous) for (const head of next) {
            requireAig(edges.length + additions.length < AIG_IMPORT_LIMITS.objects * 3, "DOT edge count exceeds the import limit", source, first);
            additions.push({ tail, head, line: first.line, column: first.column });
          }
          previous = next;
        }
        const values = attributes();
        for (const edge of additions) edges.push({ ...edge, attributes: { ...scope.edge, ...values } });
      } else {
        const values = attributes();
        for (const id of previous) Object.assign(nodes.get(id).attributes, values);
      }
    }
    expect("}");
    return [...members];
  }
  const strict = Boolean(accept("strict"));
  expect("digraph");
  const name = at("{") ? "AIG" : identifier().value;
  group({ node: {}, edge: {} }, 0);
  accept(";");
  requireAig(position === tokens.length, "Unexpected content after DOT graph", source, peek());
  // strict DOT merges duplicate edges, which loses AIG input-slot multiplicity.
  requireAig(!strict, "Strict DOT is not supported: AIG requires distinct input-slot edges", source);
  return { format: "abc-dot", name, nodes: [...nodes.values()], edges };
}

function tokenize(text, source) {
  const tokens = [];
  let index = 0;
  let line = 1;
  let column = 1;
  const advance = () => {
    const character = text[index++];
    if (character === "\n") { line++; column = 1; } else column++;
    return character;
  };
  while (index < text.length) {
    const character = text[index];
    if (/\s/.test(character)) { advance(); continue; }
    if (character === "#" || text.startsWith("//", index)) {
      while (index < text.length && advance() !== "\n") { /* Skip comments. */ }
      continue;
    }
    if (text.startsWith("/*", index)) {
      const location = { line, column };
      advance(); advance();
      while (index < text.length && !text.startsWith("*/", index)) advance();
      requireAig(index < text.length, "Unterminated DOT comment", source, location);
      advance(); advance();
      continue;
    }
    const token = { line, column, kind: "symbol", value: character };
    if (text.startsWith("->", index)) {
      advance(); advance(); token.value = "->";
    } else if ("{}[]=;,:+".includes(character)) advance();
    else if (character === '"') {
      advance(); token.kind = "id"; token.quoted = true; token.value = "";
      let closed = false;
      while (index < text.length) {
        const current = advance();
        if (current === '"') { closed = true; break; }
        if (current === "\\") {
          requireAig(index < text.length, "Unterminated DOT escape", source, token);
          const escaped = advance();
          if (escaped === "\n") continue;
          if (escaped === "\r" && text[index] === "\n") { advance(); continue; }
          token.value += escaped === '"' ? escaped : `\\${escaped}`;
        } else token.value += current;
      }
      requireAig(closed, "Unterminated DOT string", source, token);
    } else {
      // HTML IDs may contain arbitrary markup. The ABC writer does not emit them.
      if (character === "<") throw aigError("HTML labels are outside the ABC AIG DOT format", source, token);
      const match = text.slice(index).match(/^(?:[A-Za-z_\u0080-\uFFFF][A-Za-z_0-9\u0080-\uFFFF]*|-?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?))/);
      requireAig(Boolean(match), `Unexpected DOT character '${character}'`, source, token);
      token.kind = "id"; token.value = match[0];
      for (let count = 0; count < token.value.length; count++) advance();
    }
    tokens.push(token);
    requireAig(tokens.length <= AIG_IMPORT_LIMITS.tokens, "DOT token count exceeds the import limit", source, token);
  }
  return tokens;
}
