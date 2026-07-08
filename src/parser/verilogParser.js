import {
  addAssign,
  addCell,
  createDesign,
  createModule,
  ensureNet,
  ensurePort
} from "../netlist/model.js";

const PUNCTUATION = new Set(["(", ")", ";", ",", ".", "="]);
const DECLARATION_QUALIFIERS = new Set(["wire", "reg", "logic", "signed", "supply0", "supply1"]);

export function parseVerilog(source) {
  const tokens = tokenize(source);
  const parser = new StructuralParser(tokens);
  return parser.parseDesign();
}

export function tokenize(source) {
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

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      advance();
      continue;
    }

    if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") {
        advance();
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

    if (PUNCTUATION.has(char)) {
      pushToken("punctuation", char, char, startLine, startColumn);
      advance();
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

    let raw = "";
    while (
      index < source.length &&
      !/\s/.test(source[index]) &&
      !PUNCTUATION.has(source[index])
    ) {
      raw += advance();
    }
    pushToken("identifier", raw, raw, startLine, startColumn);
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
  constructor(tokens) {
    this.tokens = tokens;
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

    if (this.matchValue("(")) {
      while (!this.isEof() && !this.matchValue(")")) {
        const token = this.consume();
        if (token.kind === "identifier" && !isRangeToken(token.value)) {
          ensurePort(module, token.value, token.displayName, "unknown");
        }
      }
    }
    this.matchValue(";");

    while (!this.isEof() && this.peekValue() !== "endmodule") {
      const value = this.peekValue();
      if (value === "input" || value === "output" || value === "inout") {
        this.parseDeclaration(module, value);
      } else if (value === "wire") {
        this.parseDeclaration(module, "wire");
      } else if (value === "assign") {
        this.parseAssign(module);
      } else if (this.isCellInstanceStart()) {
        this.parseCellInstance(module);
      } else {
        this.skipStatement();
      }
    }

    this.matchValue("endmodule");
    return module;
  }

  parseDeclaration(module, declarationKind) {
    this.consume();
    const direction = declarationKind === "wire" ? null : declarationKind;

    while (!this.isEof() && !this.matchValue(";")) {
      const token = this.consume();
      if (token.kind !== "identifier") {
        continue;
      }
      if (isRangeToken(token.value) || DECLARATION_QUALIFIERS.has(token.value)) {
        continue;
      }

      if (direction) {
        ensurePort(module, token.value, token.displayName, direction);
      } else {
        ensureNet(module, token.value, token.displayName, "wire");
      }
    }
  }

  parseAssign(module) {
    const assignToken = this.expectValue("assign");
    const lhs = this.consumeUntilIdentifier("=");
    this.matchValue("=");
    const rhs = this.consumeUntilIdentifier(";");
    this.skipUntilValue(";");
    this.matchValue(";");

    if (lhs && rhs) {
      addAssign(module, {
        lhs: lhs.value,
        lhsDisplayName: lhs.displayName,
        rhs: rhs.value,
        rhsDisplayName: rhs.displayName,
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
    const instanceToken = this.expectIdentifier("instance name");
    const pins = [];

    if (!typeToken || !instanceToken || !this.matchValue("(")) {
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
        this.consume();
        continue;
      }

      const pinToken = this.expectIdentifier("pin name");
      if (!pinToken || !this.matchValue("(")) {
        continue;
      }
      const netToken = this.readConnectionNet();
      this.matchValue(")");

      pins.push({
        pin: pinToken.value,
        pinDisplayName: pinToken.displayName,
        net: netToken?.value || "",
        netDisplayName: netToken?.displayName || ""
      });
    }

    this.matchValue(";");
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
    let firstIdentifier = null;

    while (!this.isEof()) {
      const token = this.peek();
      if (token.value === ")" && depth === 0) {
        break;
      }
      if (token.value === "(") {
        depth += 1;
        this.consume();
        continue;
      }
      if (token.value === ")") {
        depth -= 1;
        this.consume();
        continue;
      }
      if (!firstIdentifier && token.kind === "identifier") {
        firstIdentifier = token;
      }
      this.consume();
    }

    return firstIdentifier;
  }

  consumeUntilIdentifier(stopValue) {
    while (!this.isEof() && this.peekValue() !== stopValue) {
      const token = this.consume();
      if (token.kind === "identifier") {
        return token;
      }
    }
    return null;
  }

  isCellInstanceStart() {
    return (
      this.peek(0).kind === "identifier" &&
      this.peek(1).kind === "identifier" &&
      this.peek(2).value === "("
    );
  }

  skipStatement() {
    this.skipUntilValue(";");
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
    return this.peek(offset).value;
  }

  consume() {
    return this.tokens[this.position++] || this.tokens[this.tokens.length - 1];
  }

  isEof() {
    return this.peek().kind === "eof";
  }
}

function isRangeToken(value) {
  return value.startsWith("[") && value.endsWith("]");
}
