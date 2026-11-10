export const LIBERTY_FUNCTION_LIMITS = Object.freeze({ maxLength: 4096, maxNodes: 256, maxDepth: 64, maxVariables: 8 });

/** Bounded Liberty boolean interpretation. No eval, rewriting or unbounded equivalence search. */
export function analyzeLibertyFunction(source, inputNames) {
  try {
    if (source.length > LIBERTY_FUNCTION_LIMITS.maxLength) throw new Error("function length limit");
    const pattern = /\s*(\\?[$A-Za-z_][$\w.\[\]:/\\-]*|[01]|[!'+|*&^()])/y;
    const tokens = [];
    let offset = 0;
    while (offset < source.length) {
      if (!source.slice(offset).trim()) break;
      pattern.lastIndex = offset;
      const match = pattern.exec(source);
      if (!match) throw new Error("unsupported function token");
      tokens.push(match[1]); offset = pattern.lastIndex;
      if (tokens.length > LIBERTY_FUNCTION_LIMITS.maxNodes * 3) throw new Error("function token limit");
    }
    const variables = new Set();
    let cursor = 0, nodes = 0;
    const node = (operator, left, right) => {
      if (++nodes > LIBERTY_FUNCTION_LIMITS.maxNodes) throw new Error("function node limit");
      return { operator, left, right };
    };
    const atomStarts = (token) => token && !["+", "|", "*", "&", "^", ")", "'"].includes(token);
    function expression(minimum = 0, depth = 0) {
      if (depth > LIBERTY_FUNCTION_LIMITS.maxDepth) throw new Error("function depth limit");
      let left;
      const token = tokens[cursor++];
      if (token === "!") left = node("not", expression(4, depth + 1));
      else if (token === "(") {
        left = expression(0, depth + 1);
        if (tokens[cursor++] !== ")") throw new Error("missing ')' in function");
      } else if (token === "0" || token === "1") left = node("constant", token === "1");
      else if (token && !/[!'+|*&^()]/.test(token)) {
        if (!inputNames.includes(token)) throw new Error(`function references non-input ${token}`);
        variables.add(token); left = node("pin", token);
      } else throw new Error("expected function operand");
      while (tokens[cursor] === "'") { cursor += 1; left = node("not", left); }
      for (;;) {
        const next = tokens[cursor];
        const implicit = atomStarts(next);
        const precedence = next === "+" || next === "|" ? 1 : next === "*" || next === "&" || implicit ? 2 : next === "^" ? 3 : 0;
        if (!precedence || precedence < minimum) break;
        if (!implicit) cursor += 1;
        left = node(precedence === 1 ? "or" : precedence === 2 ? "and" : "xor", left, expression(precedence + 1, depth + 1));
      }
      return left;
    }
    const tree = expression();
    if (cursor !== tokens.length) throw new Error("trailing function tokens");
    const names = [...variables].sort();
    if (names.length > LIBERTY_FUNCTION_LIMITS.maxVariables) throw new Error("function variable limit");
    const evaluate = (item, values) => {
      if (item.operator === "constant") return item.left;
      if (item.operator === "pin") return values[item.left];
      if (item.operator === "not") return !evaluate(item.left, values);
      if (item.operator === "and") return evaluate(item.left, values) && evaluate(item.right, values);
      if (item.operator === "or") return evaluate(item.left, values) || evaluate(item.right, values);
      return evaluate(item.left, values) !== evaluate(item.right, values);
    };
    const rows = Array.from({ length: 2 ** names.length }, (_, mask) => {
      const values = Object.fromEntries(names.map((name, index) => [name, Boolean(mask & (1 << index))]));
      return { values, result: evaluate(tree, values), inputs: Object.values(values) };
    });
    if (!names.length) return { kind: "blackbox", status: "constant" };
    const candidates = names.length === 1 ? ["buf", "inv"] : ["and", "nand", "or", "nor", "xor", "xnor"];
    for (const kind of candidates) {
      const invert = ["inv", "nand", "nor", "xnor"].includes(kind);
      if (rows.every(({ inputs, result }) => {
        const value = kind === "buf" || kind === "inv" ? inputs[0] : kind === "and" || kind === "nand"
          ? inputs.every(Boolean) : kind === "or" || kind === "nor" ? inputs.some(Boolean)
            : inputs.filter(Boolean).length % 2 === 1;
        return result === (invert ? !value : value);
      })) return { kind, status: "recognized" };
    }
    if (names.length === 3) {
      for (const select of names) {
        const data = names.filter((name) => name !== select);
        for (const [low, high] of [data, [...data].reverse()]) {
          if (rows.every(({ values, result }) => result === values[values[select] ? high : low])) {
            return { kind: "mux", status: "recognized", selectPin: select };
          }
        }
      }
    }
    return { kind: "blackbox", status: "complex" };
  } catch (error) { return { kind: "blackbox", status: "unsupported", reason: error.message }; }
}
