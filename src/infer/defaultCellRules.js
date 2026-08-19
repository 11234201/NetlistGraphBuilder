const OUTPUT_PINS = new Set(["Z", "ZN", "Y", "Q", "QN", "CO"]);
const INVERTING_OUTPUT_GATES = new Set(["nand", "nor", "inv", "xnor"]);
const MUX_SELECT_PINS = /^(S|S\d+|SEL|SELECT)$/;

export function inferCellKind(cellType) {
  const type = cellType.toUpperCase();

  if (isDffCellType(type)) {
    return inference("dff", "rule");
  }
  if (type.startsWith("XNR") || type.startsWith("XNOR")) {
    return inference("xnor", "rule");
  }
  if (type.startsWith("XOR")) {
    return inference("xor", "rule");
  }
  if (type.includes("INV")) {
    return inference("inv", "rule");
  }
  if (type.startsWith("CKND") || type.startsWith("ND") || type.startsWith("NAND")) {
    return inference("nand", "rule");
  }
  if (type.startsWith("NR") || type.startsWith("NOR")) {
    return inference("nor", "rule");
  }
  if (type.startsWith("BUF") || type.includes("BUFF")) {
    return inference("buf", "rule");
  }
  if (isMuxCellType(type)) {
    return inference("mux", "rule");
  }

  return inference("blackbox", "unknown");
}

export function inferPinDirection(pinName, cellType = "") {
  const pin = pinName.toUpperCase();
  const type = String(cellType).toUpperCase();
  if (isMuxCellType(type) && MUX_SELECT_PINS.test(pin)) {
    return {
      direction: "input",
      source: "cell-rule",
      role: "select",
      side: "left"
    };
  }
  if (pin === "S" && isAdderCellType(type)) {
    return { direction: "output", source: "cell-rule", role: "sum" };
  }
  if (OUTPUT_PINS.has(pin)) {
    return { direction: "output", source: "rule" };
  }
  return { direction: "input", source: "fallback" };
}

export function ensureFallbackCellPinDirections(pinDirections) {
  const directions = Object.fromEntries(Object.entries(pinDirections || {}).map(([pin, rule]) => [
    pin,
    { ...rule }
  ]));
  const entries = Object.entries(directions)
    .sort(([left], [right]) => comparePinNames(left, right));
  if (entries.length === 0) return directions;

  if (entries.length === 1) {
    const [pin, rule] = entries[0];
    if (!isFallbackDirection(rule)) return directions;
    directions[pin] = {
      ...rule,
      direction: "inout",
      source: "fallback-guarantee"
    };
    return directions;
  }

  const hasInput = entries.some(([, rule]) => isInputDirection(rule.direction));
  const hasOutput = entries.some(([, rule]) => isOutputDirection(rule.direction));
  const fallbackEntries = entries.filter(([, rule]) => isFallbackDirection(rule));

  if (!hasOutput) {
    const candidate = fallbackEntries.at(-1);
    if (candidate) {
      const [pin, rule] = candidate;
      directions[pin] = {
        ...rule,
        direction: "output",
        source: "fallback-guarantee"
      };
    }
  }

  if (!hasInput) {
    const candidate = fallbackEntries.find(([pin]) => directions[pin]?.direction !== "output");
    if (candidate) {
      const [pin, rule] = candidate;
      directions[pin] = {
        ...rule,
        direction: "input",
        source: "fallback-guarantee"
      };
    }
  }

  return directions;
}

export function isInvertingOutputGate(gateKind) {
  return INVERTING_OUTPUT_GATES.has(gateKind);
}

function inference(kind, source) {
  return { kind, source };
}

function isInputDirection(direction) {
  return direction === "input" || direction === "inout";
}

function isOutputDirection(direction) {
  return direction === "output" || direction === "inout";
}

function isFallbackDirection(rule) {
  return rule?.direction === "unknown" || rule?.source === "fallback";
}

function comparePinNames(left, right) {
  const a = String(left).replace(/^\\/, "");
  const b = String(right).replace(/^\\/, "");
  return a < b ? -1 : a > b ? 1 : 0;
}

function isMuxCellType(type) {
  return /^(MUX|MX\d|MXI\d)/.test(type);
}

function isDffCellType(type) {
  return /^(DFF|SDFF)/.test(type);
}

function isAdderCellType(type) {
  return /^(FA|HA|ADD|ADDF|HADD)/.test(type);
}
