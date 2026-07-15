const OUTPUT_PINS = new Set(["Z", "ZN", "Y", "Q", "QN", "CO"]);
const INVERTING_OUTPUT_GATES = new Set(["nand", "nor", "inv", "xnor"]);
const MUX_SELECT_PINS = /^(S|S\d+|SEL|SELECT)$/;

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
      side: "top"
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

export function isInvertingOutputGate(gateKind) {
  return INVERTING_OUTPUT_GATES.has(gateKind);
}

function inference(kind, source) {
  return { kind, source };
}

function isMuxCellType(type) {
  return /^(MUX|MX\d|MXI\d)/.test(type);
}

function isAdderCellType(type) {
  return /^(FA|HA|ADD|ADDF|HADD)/.test(type);
}
