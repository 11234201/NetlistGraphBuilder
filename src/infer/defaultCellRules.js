const OUTPUT_PINS = new Set(["Z", "ZN", "Y", "Q", "QN", "CO", "S"]);
const INVERTING_OUTPUT_GATES = new Set(["nand", "nor", "inv", "xnor"]);

export function inferCellKind(cellType) {
  const type = cellType.toUpperCase();

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

  return inference("blackbox", "unknown");
}

export function inferPinDirection(pinName) {
  const pin = pinName.toUpperCase();
  if (OUTPUT_PINS.has(pin)) {
    return { direction: "output", source: "rule" };
  }
  return { direction: "input", source: "fallback" };
}

export function isInvertingOutputGate(gateKind) {
  return INVERTING_OUTPUT_GATES.has(gateKind);
}

function inference(kind, source) {
  return { kind, source };
}
