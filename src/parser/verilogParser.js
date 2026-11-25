import {
  addAssign,
  addCell,
  addEntityAttributes,
  createDesign,
  createModule,
  ensureNet,
  ensurePort,
  isExpandableRange,
  vectorRangeDiagnostic
} from "../netlist/model.js";
import { parseAttributeComment } from "./netlistAttributes.js";

const PUNCTUATION = new Set(["(", ")", ";", ",", ".", "=", "{", "}", "#", "@"]);
const DECLARATION_QUALIFIERS = new Set(["wire", "reg", "logic", "signed", "supply0", "supply1"]);
const PORT_DIRECTIONS = new Set(["input", "output", "inout"]);

export function parseVerilog(source) {
  const attributeComments = [];
  const diagnostics = [];
  const tokens = tokenize(source, attributeComments, diagnostics);
  const parser = new StructuralParser(tokens, attributeComments);
  parser.design.diagnostics = diagnostics;
  return parser.parseDesign();
}

export function tokenize(source, attributeComments = null, diagnostics = null) {
  const tokens = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const advance = () => {
    const char = source[index++];
    if (char === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    return char;
  };

  const pushToken = (kind, value, raw, startLine, startColumn, extra = {}) => {
    tokens.push({
      kind,
      value,
      raw,
      displayName: extra.displayName || value,
      escaped: Boolean(extra.escaped),
      line: startLine,
      column: startColumn
    });
  };

  const readRange = () => {
    const start = index;
    let parentheses = 0;
    while (index < source.length) {
      const next = source[index];
      if (next === ";" || (next === ")" && parentheses === 0)) break;
      if (next === "(") parentheses++;
      if (next === ")") parentheses--;
      if (advance() === "]") break;
    }
    return source.slice(start, index);
  };

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      advance();
      continue;
    }

    if (char === "/" && source[index + 1] === "/") {
      const startLine = line;
      advance();
      advance();
      let commentText = "";
      while (index < source.length && source[index] !== "\n") {
        commentText += advance();
      }
      if (attributeComments) {
        const parsed = parseAttributeComment(commentText.replace(/\r$/, ""), startLine);
        if (parsed) attributeComments.push(parsed);
      }
      continue;
    }

    if (char === "/" && source[index + 1] === "*") {
      advance();
      advance();
      while (index < source.length) {
        if (source[index] === "*" && source[index + 1] === "/") {
          advance();
          advance();
          break;
        }
        advance();
      }
      continue;
    }

    const startLine = line;
    const startColumn = column;

    if (char === "(" && source[index + 1] === "*" && source[index + 2] !== ")" && tokens.at(-1)?.raw !== "@") {
      advance();
      advance();
      let quoted = false;
      let depth = 1;
      while (depth && index < source.length) {
        const c = advance();
        if (quoted && c === "\\") {
          if (index < source.length) advance();
        } else if (c === '"') quoted = !quoted;
        else if (!quoted && c === "(" && source[index] === "*") {
          advance();
          depth++;
        } else if (!quoted && c === "*" && source[index] === ")") {
          advance();
          depth--;
        } else if (!quoted && c === "/" && source[index] === "/") {
          while (index < source.length && source[index] !== "\n") advance();
        } else if (!quoted && c === "/" && source[index] === "*") {
          advance();
          while (index < source.length) {
            if (advance() === "*" && source[index] === "/") { advance(); break; }
          }
        } else if (!quoted && c === "\\") {
          while (index < source.length && !/\s/.test(source[index])) advance();
        }
      }
      if (depth) diagnostics?.push({ severity: "error", code: "unterminated-attribute",
        line: startLine, column: startColumn, message: "Unterminated Verilog attribute block" });
      continue;
    }

    if (PUNCTUATION.has(char)) {
      pushToken("punctuation", char, char, startLine, startColumn);
      advance();
      continue;
    }

    if (char === "[") {
      const raw = readRange();
      pushToken(
        "identifier",
        raw.replace(/\s+/g, ""),
        raw,
        startLine,
        startColumn
      );
      continue;
    }

    if (char === "\\") {
      let raw = advance();
      let value = "";
      while (index < source.length && !/\s/.test(source[index])) {
        value += source[index];
        raw += advance();
      }
      pushToken("identifier", value, raw, startLine, startColumn, {
        displayName: `\\${value}`,
        escaped: true
      });
      continue;
    }

    const start = index;
    let value = "";
    while (
      index < source.length &&
      !/\s/.test(source[index]) &&
      !PUNCTUATION.has(source[index]) &&
      !(source[index] === "/" && (source[index + 1] === "/" || source[index + 1] === "*"))
    ) {
      if (source[index] === "[") {
        if (PORT_DIRECTIONS.has(value) || DECLARATION_QUALIFIERS.has(value)) break;
        value += readRange().replace(/\s+/g, "");
      } else {
        value += advance();
      }
    }
    pushToken("identifier", value, source.slice(start, index), startLine, startColumn);
  }

  tokens.push({
    kind: "eof",
    value: "<eof>",
    raw: "",
    displayName: "<eof>",
    escaped: false,
    line,
    column
  });
  return tokens;
}

class StructuralParser {
  constructor(tokens, attributeComments = []) {
    this.tokens = tokens;
    this.attributeComments = attributeComments;
    this.commentIndex = 0;
    this.position = 0;
    this.design = createDesign();
  }

  parseDesign() {
    while (!this.isEof()) {
      if (this.peekValue() === "module") {
        const module = this.parseModule();
        if (module) {
          this.design.modules.push(module);
        }
      } else {
        this.consume();
      }
    }
    return this.design;
  }

  parseModule() {
    const moduleToken = this.expectValue("module");
    const nameToken = this.expectIdentifier("module name");
    if (!nameToken) {
      this.skipUntilValue("endmodule");
      return null;
    }

    const module = createModule(nameToken.value, nameToken.displayName, {
      line: moduleToken.line,
      column: moduleToken.column
    });

    if (this.matchValue("#")) {
      const token = this.tokens[this.position - 1];
      warn(module, token, "unsupported-parameter-list", "Module parameter values are not evaluated");
      if (this.matchValue("(")) this.skipParenthesized();
    }
    if (this.matchValue("(")) {
      let headerDirection = "unknown";
      let headerRange = null;
      while (!this.isEof() && !this.matchValue(")")) {
        const token = this.consume();
        if (token.kind !== "identifier") continue;
        if (!token.escaped && PORT_DIRECTIONS.has(token.value)) {
          headerDirection = token.value;
          headerRange = null;
          continue;
        }
        if (!token.escaped && token.value.startsWith("[")) {
          headerRange = parseRangeToken(module, token);
          continue;
        }
        if (!token.escaped && DECLARATION_QUALIFIERS.has(token.value)) continue;
        declareSignal(module, token, headerDirection, headerRange);
      }
    }
    this.matchValue(";");

    while (!this.isEof() && this.peekValue() !== "endmodule") {
      const value = this.peekValue();
      if (PORT_DIRECTIONS.has(value)) {
        this.parseDeclaration(module, value);
      } else if (value === "wire") {
        this.parseDeclaration(module, "wire");
      } else if (value === "assign") {
        this.parseAssign(module);
      } else if (["reg", "logic", "supply0", "supply1"].includes(value)) {
        warn(module, this.peek(), "unsupported-declaration", "Skipped unsupported " + value + " declaration");
        this.skipStatement();
      } else if (this.isCellInstanceStart()) {
        this.parseCellInstance(module);
      } else {
        this.skipStatement();
      }
    }

    const moduleStartLine = moduleToken.line;
    const matchedEnd = this.matchValue("endmodule");
    const endToken = matchedEnd ? this.tokens[this.position - 1] : this.peek();
    const moduleEndLine = endToken?.line ?? moduleStartLine;
    const firstComment = this.commentIndex;
    while (this.attributeComments[this.commentIndex]?.entries[0]?.line <= moduleEndLine) this.commentIndex++;
    bindModuleAttributeComments(module, this.attributeComments.slice(firstComment, this.commentIndex));
    return module;
  }

  parseDeclaration(module, declarationKind) {
    this.consume();
    const direction = declarationKind === "wire" ? null : declarationKind;
    let range = null;

    while (!this.isEof() && !this.matchValue(";")) {
      const token = this.consume();
      if (token.kind !== "identifier") {
        continue;
      }
      if (!token.escaped && token.value.startsWith("[")) {
        range = parseRangeToken(module, token);
        continue;
      }
      if (!token.escaped && DECLARATION_QUALIFIERS.has(token.value)) {
        continue;
      }

      declareSignal(module, token, direction, range);
      if (this.matchValue("=")) {
        warn(module, token, "unsupported-inline-assignment", "Skipped inline net initializer");
        let depth = 0;
        while (!this.isEof() && this.peekValue() !== ";" && (depth || this.peekValue() !== ",")) {
          const value = this.peekValue();
          this.consume();
          if (value === "(" || value === "{") depth++;
          if (value === ")" || value === "}") depth--;
        }
      }
    }
  }

  parseAssign(module) {
    const assignToken = this.expectValue("assign");
    const lhsTokens = this.consumeUntilValue("=");
    this.matchValue("=");
    const rhsTokens = this.consumeUntilValue(";");
    this.matchValue(";");
    const lhs = parseConnectionTokens(lhsTokens);
    const rhs = parseConnectionTokens(rhsTokens);

    if (lhs?.kind === "reference" && !lhs.literal && rhs?.kind === "reference") {
      addAssign(module, {
        lhs: lhs.name,
        lhsDisplayName: lhs.displayName,
        rhs: rhs.name,
        rhsDisplayName: rhs.displayName,
        ...(rhs.literal ? { rhsKind: "literal" } : {}),
        span: { line: assignToken.line, column: assignToken.column }
      });
    } else {
      module.diagnostics.push({
        severity: "warning",
        message: "Skipped unsupported assign statement",
        line: assignToken.line,
        column: assignToken.column
      });
    }
  }

  parseCellInstance(module) {
    const typeToken = this.expectIdentifier("cell type");
    if (!typeToken) {
      this.skipStatement();
      return;
    }
    do {
      this.parseCellInstanceOfType(module, typeToken);
    } while (this.matchValue(","));
    this.matchValue(";");
  }

  parseCellInstanceOfType(module, typeToken) {
    const instanceToken = this.expectIdentifier("instance name");
    const pins = [];

    if (!instanceToken || !this.matchValue("(")) {
      this.skipStatement();
      return;
    }

    while (!this.isEof()) {
      if (this.matchValue(")")) {
        break;
      }
      if (this.matchValue(",")) {
        continue;
      }
      if (!this.matchValue(".")) {
        warn(module, this.peek(), "unsupported-positional-ports", "Skipped instance with unsupported positional port connections");
        this.skipParenthesized();
        return;
      }

      const pinToken = this.expectIdentifier("pin name");
      if (!pinToken || !this.matchValue("(")) {
        continue;
      }
      const connection = this.readConnectionNet();
      this.matchValue(")");

      if (connection?.kind === "unsupported") {
        warn(module, pinToken, "unsupported-pin-expression", "Unsupported pin connection expression");
      }

      pins.push({
        pin: pinToken.value,
        pinDisplayName: pinToken.displayName,
        net: connection?.kind === "reference" ? connection.name : "",
        netDisplayName: connection?.kind === "reference" ? connection.displayName : "",
        ...(connection?.kind === "reference" && connection.displayName.startsWith("\\") ? { escaped: connection.escaped } : {}),
        ...(connection?.literal ? { netKind: "literal" } : {}),
        ...(connection && connection.kind !== "reference" ? { connection } : {})
      });
    }

    addCell(module, {
      type: typeToken.value,
      typeDisplayName: typeToken.displayName,
      instance: instanceToken.value,
      instanceDisplayName: instanceToken.displayName,
      pins,
      span: { line: typeToken.line, column: typeToken.column }
    });
  }

  readConnectionNet() {
    let depth = 0;
    const tokens = [];

    while (!this.isEof()) {
      const value = this.peekValue();
      if (value === ")" && depth === 0) {
        break;
      }
      if (value === "(") {
        depth += 1;
        tokens.push(this.consume());
        continue;
      }
      if (value === ")") {
        depth -= 1;
        tokens.push(this.consume());
        continue;
      }
      tokens.push(this.consume());
    }

    return parseConnectionTokens(tokens);
  }

  consumeUntilValue(stopValue) {
    const tokens = [];
    while (!this.isEof() && this.peekValue() !== stopValue) {
      tokens.push(this.consume());
    }
    return tokens;
  }

  isCellInstanceStart() {
    return (
      this.peek(0).kind === "identifier" &&
      this.peek(1).kind === "identifier" &&
      this.peekValue(2) === "("
    );
  }

  skipParenthesized() {
    let depth = 1;
    while (depth && !this.isEof() && this.peekValue() !== ";") {
      const value = this.peekValue();
      this.consume();
      if (value === "(") depth++;
      if (value === ")") depth--;
    }
  }

  skipStatement() {
    while (!this.isEof() && this.peekValue() !== ";" && this.peekValue() !== "endmodule") this.consume();
    this.matchValue(";");
  }

  skipUntilValue(value) {
    while (!this.isEof() && this.peekValue() !== value) {
      this.consume();
    }
  }

  expectIdentifier(label) {
    const token = this.consume();
    if (token.kind === "identifier") {
      return token;
    }
    this.design.diagnostics.push({
      severity: "error",
      message: `Expected ${label}`,
      line: token.line,
      column: token.column
    });
    return null;
  }

  expectValue(value) {
    const token = this.consume();
    if (token.value !== value) {
      this.design.diagnostics.push({
        severity: "error",
        message: `Expected ${value}`,
        line: token.line,
        column: token.column
      });
    }
    return token;
  }

  matchValue(value) {
    if (this.peekValue() === value) {
      this.consume();
      return true;
    }
    return false;
  }

  peek(offset = 0) {
    return this.tokens[this.position + offset] || this.tokens[this.tokens.length - 1];
  }

  peekValue(offset = 0) {
    const token = this.peek(offset);
    return token.escaped ? null : token.value;
  }

  consume() {
    return this.tokens[this.position++] || this.tokens[this.tokens.length - 1];
  }

  isEof() {
    return this.peek().kind === "eof";
  }
}

function parseConnectionTokens(tokens) {
  if (tokens.length === 0) return null;
  const first = tokens[0];
  if (first.kind === "punctuation" && first.value === "{" && tokens.at(-1).kind === "punctuation" && tokens.at(-1).value === "}") {
    const items = [];
    let start = 1;
    let depth = 0;
    for (let index = 1; index < tokens.length - 1; index += 1) {
      const value = tokens[index].escaped ? null : tokens[index].value;
      if (value === "{") depth += 1;
      if (value === "}") depth -= 1;
      if (value === "," && depth === 0) {
        items.push(parseConnectionTokens(tokens.slice(start, index)));
        start = index + 1;
      }
    }
    items.push(parseConnectionTokens(tokens.slice(start, -1)));
    if (items.every((item) => item && item.kind !== "unsupported")) {
      return { kind: "concat", items };
    }
  }
  const literal = !first.escaped && isLiteralToken(first.value);
  const isReference = first.escaped ||
    /^[A-Za-z_$][A-Za-z0-9_$]*(?:\[-?\d+(?::-?\d+)?\])?$/.test(first.value) || literal;
  if (first.kind === "identifier" && isReference && (tokens.length === 1 ||
      (tokens.length === 2 && !tokens[1].escaped && /^\[(-?\d+)(:-?\d+)?\]$/.test(tokens[1].value)))) {
    const suffix = tokens[1]?.value || "";
    return { kind: "reference", name: first.value + suffix,
      displayName: first.displayName + suffix, escaped: first.escaped && !suffix,
      ...(literal ? { literal: true } : {}) };
  }
  return { kind: "unsupported", text: tokens.map((token) => token.raw).join(" ") };
}

function isLiteralToken(value) {
  return /^(?:\d+)?'[sS]?[bBdDhHoO][0-9a-fA-FxXzZ?_]+$/.test(value) ||
    /^'[01xXzZ]$/.test(value) || /^-?\d+$/.test(value);
}

function parseRangeToken(module, token) {
  if (!token.value.endsWith("]")) warn(module, token, "unterminated-range", "Unterminated packed range");
  const match = token.value.match(/^\[(-?\d+):(-?\d+)\]$/);
  if (!match) return null;
  const msb = Number(match[1]);
  const lsb = Number(match[2]);
  return {
    msb,
    lsb,
    width: Math.abs(msb - lsb) + 1
  };
}

function warn(module, token, code, message) {
  const span = { line: token.line, column: token.column };
  module.diagnostics.push({ severity: "warning", code, moduleName: module.name, message, ...span, span });
}

function declareSignal(module, token, direction, range) {
  const entity = direction
    ? ensurePort(module, token.value, token.displayName, direction, range)
    : ensureNet(module, token.value, token.displayName, "wire", range);
  if (token.escaped) {
    entity.escaped = true;
    if (direction) ensureNet(module, token.value).escaped = true;
  }
  if (range && !isExpandableRange(range.msb, range.lsb)) {
    module.diagnostics.push(vectorRangeDiagnostic(module.name, token.value, range.msb, range.lsb,
      { line: token.line, column: token.column }));
  }
}

function bindModuleAttributeComments(module, scoped) {
  if (!scoped.length) return;
  const portByName = new Map(module.ports.map((port) => [port.name, port]));
  const netByName = new Map(module.nets.map((net) => [net.name, net]));
  const cellByInstance = new Map(module.cells.map((cell) => [cell.instance, cell]));

  for (const comment of scoped) {
    const t = comment.target;
    if (comment.targetKind === "module") {
      if (t.targetName === module.name || t.displayName === module.displayName) {
        addEntityAttributes(module, comment.entries);
      }
      continue;
    }

    if (comment.targetKind === "port") {
      const port = portByName.get(t.targetName) ||
        (t.baseName ? portByName.get(t.baseName) : null) ||
        (t.bitBaseName ? portByName.get(t.bitBaseName) : null) ||
        (t.rangeFallbackBase ? portByName.get(t.rangeFallbackBase) : null);
      if (port) {
        const entries = t.isBitTarget && port.name !== t.targetName
          ? comment.entries.map((entry) => ({ ...entry, bitTarget: t.targetName }))
          : comment.entries;
        addEntityAttributes(port, entries);
      }
      continue;
    }

    if (comment.targetKind === "net") {
      const net = netByName.get(t.targetName) ||
        (t.baseName ? netByName.get(t.baseName) : null) ||
        (t.bitBaseName ? netByName.get(t.bitBaseName) : null) ||
        (t.rangeFallbackBase ? netByName.get(t.rangeFallbackBase) : null);
      if (net) {
        const entries = t.isBitTarget && net.name !== t.targetName
          ? comment.entries.map((entry) => ({ ...entry, bitTarget: t.targetName }))
          : comment.entries;
        addEntityAttributes(net, entries);
      } else if (!t.isBitTarget && (t.baseName || t.bitBaseName)) {
        const base = t.baseName || t.bitBaseName;
        for (const candidate of module.nets) {
          if (candidate.name.startsWith(`${base}[`)) {
            addEntityAttributes(candidate, comment.entries);
          }
        }
      }
      continue;
    }

    if (comment.targetKind === "instance") {
      const cell = cellByInstance.get(t.targetName);
      if (cell) {
        addEntityAttributes(cell, comment.entries);
      }
    }
  }
}
