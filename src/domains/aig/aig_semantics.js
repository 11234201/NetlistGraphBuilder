import { AIG_IMPORT_LIMITS, requireAig } from "./aig_diagnostics.js";

export function adaptAbcDot(source, options = {}) {
  const context = { ...options, format: "abc-dot" };
  const nodes = [];
  const byId = new Map();
  const helpers = new Set();
  const outputs = [];
  for (const record of source.nodes) {
    const attributes = record.attributes;
    const shape = attributes.shape || "ellipse";
    const label = attributes.label === undefined ? record.id : decodeLabel(attributes.label, record.id);
    if (shape === "plaintext") { helpers.add(record.id); continue; }
    let kind = { triangle: "pi", invtriangle: "po", ellipse: "and" }[shape];
    if (shape === "box" && /^(?:Const)?[01]$/.test(label.trim())) kind = "constant";
    requireAig(Boolean(kind), `Unsupported ABC AIG node shape '${shape}' at ${record.id}`, context, record);
    const node = { id: record.id, kind, label, fanins: [], line: record.line, column: record.column };
    if (kind === "constant") node.value = Number(label.trim().at(-1));
    byId.set(node.id, node);
    nodes.push(node);
  }
  for (const edge of source.edges) {
    const styles = (edge.attributes.style || "solid").split(",").map((value) => value.trim());
    if (styles.includes("invis")) continue;
    requireAig(!helpers.has(edge.tail) && !helpers.has(edge.head), "Visible edge touches an ABC layout helper", context, edge);
    requireAig(edge.attributes.dir === "back", "Expected ABC AIG edge dir=back (consumer to fanin)", context, edge);
    requireAig(styles.length === 1 && ["solid", "dotted"].includes(styles[0]), "ABC AIG edges require solid or dotted polarity", context, edge);
    const consumer = byId.get(edge.tail);
    const driver = byId.get(edge.head);
    requireAig(consumer && driver, "Undefined ABC AIG edge endpoint", context, edge);
    requireAig(driver.kind !== "po", `Output '${driver.label}' cannot drive logic`, context, edge);
    consumer.fanins.push({ source: driver.id, inverted: styles[0] === "dotted", line: edge.line, column: edge.column });
  }
  for (const node of nodes) {
    const expected = { pi: 0, constant: 0, and: 2, po: 1 }[node.kind];
    requireAig(node.fanins.length === expected, `${node.id}: expected ${expected} fanin slot(s), found ${node.fanins.length}`, context, node);
    if (node.kind === "po") outputs.push({ id: node.id, label: node.label, ...node.fanins[0], line: node.line, column: node.column });
  }
  checkNames(nodes.filter((node) => node.kind === "pi").map((node) => ({ name: node.label, ...node })), "input", context);
  checkNames(outputs.map((output) => ({ ...output, name: output.label })), "output", context);
  requireAig(outputs.length > 0, "An AIG must declare at least one output", context);
  return { name: source.name, format: "abc-dot", nodes: nodes.filter((node) => node.kind !== "po"), outputs };
}

export function adaptAndNotBlif(source, options = {}) {
  const context = { ...options, format: "blif" };
  const nodes = [];
  const inputs = [];
  const outputs = [];
  const drivers = new Set();
  let name = "";
  let ended = false;
  let sawInputs = false;
  let sawOutputs = false;
  for (const declaration of source.declarations) {
    const args = declaration.arguments;
    const command = declaration.directive;
    requireAig(!ended, "BLIF content after .end is not supported", context, declaration);
    requireAig(name || command === ".model", "BLIF must begin with .model", context, declaration);
    if (command === ".model") {
      requireAig(!name && args.length === 1, "Expected one flat BLIF .model", context, declaration);
      name = args[0];
    } else if (command === ".inputs" || command === ".outputs") {
      if (command === ".inputs") sawInputs = true; else sawOutputs = true;
      const ports = command === ".inputs" ? inputs : outputs;
      requireAig(nodes.length + inputs.length + outputs.length + args.length <= AIG_IMPORT_LIMITS.objects,
        `BLIF object count exceeds the ${AIG_IMPORT_LIMITS.objects}-object import limit`, context, declaration, "blif.object-limit");
      for (const label of args) ports.push({ name: label, label, id: label, line: declaration.line, column: declaration.column });
    } else if (command === ".names") {
      const id = args.at(-1);
      const location = { line: declaration.line, column: declaration.column, id, inputCount: Math.max(0, args.length - 1) };
      requireAig(args.length >= 1 && args.length <= 3, "BLIF .names requires zero, one or two inputs", context, location, "blif.input-count");
      requireAig(!drivers.has(id), `Multiple BLIF drivers for '${id}'`, context, location, "blif.multiple-drivers");
      drivers.add(id);
      const record = { id, label: id, line: declaration.line, column: declaration.column };
      const declaredInputs = args.slice(0, -1);
      const { literals = [], ...gate } = classifyCover(declaration, context, location);
      const fanin = (source, inverted) => ({ source, inverted, line: record.line, column: record.column });
      if (gate.kind === "parity") {
        // Spaces cannot occur inside a BLIF name token. Both terms are symmetric
        // in their operands, including after source input/cover permutation.
        const terms = [false, true].map((inverted) => {
          const termId = `XOR ${Number(inverted)} ${id}`;
          nodes.push({ ...record, id: termId, label: termId, generatedFor: id, kind: "and",
            fanins: declaredInputs.map((source) => fanin(source, inverted)) });
          return fanin(termId, true);
        });
        nodes.push({ ...record, kind: "and", outputInverted: gate.outputInverted, fanins: terms });
      } else {
        nodes.push({ ...record, ...gate, declaredInputs, fanins: literals.map(({ slot, inverted }) => fanin(declaredInputs[slot], inverted)) });
      }
      requireAig(nodes.length + inputs.length + outputs.length <= AIG_IMPORT_LIMITS.objects,
        `BLIF object count exceeds the ${AIG_IMPORT_LIMITS.objects}-object import limit`, context, location, "blif.object-limit");
    } else if (command === ".end") {
      requireAig(args.length === 0, "Unexpected arguments after .end", context, declaration);
      ended = true;
    } else requireAig(false, `Unsupported BLIF directive '${command}'`, context, declaration, "blif.directive");
  }
  requireAig(name && ended, "BLIF requires .model and .end", context);
  requireAig(sawInputs && sawOutputs && outputs.length > 0, "BLIF requires explicit .inputs (possibly empty) and nonempty .outputs", context);
  checkNames(inputs, "input", context);
  checkNames(outputs, "output", context);
  for (const input of inputs) {
    requireAig(!drivers.has(input.name), `BLIF input '${input.name}' also has a driver`, context, input);
    nodes.push({ id: input.name, kind: "pi", label: input.name, fanins: [], line: input.line, column: input.column });
  }
  return { name, format: "blif", nodes, outputs: outputs.map((output) => ({ ...output, source: output.name, inverted: false })) };
}

function classifyCover(declaration, context, location) {
  const size = declaration.arguments.length - 1;
  const cubes = [];
  const phases = new Set();
  for (const row of declaration.rows) {
    const rowLocation = { ...location, line: row.line, column: row.column };
    requireAig(row.fields.length === (size ? 2 : 1), "Invalid BLIF cover row", context, rowLocation, "blif.cover-row");
    const cube = size ? row.fields[0] : "";
    const phase = row.fields.at(-1);
    requireAig(cube.length === size && /^[01-]*$/.test(cube) && /^[01]$/.test(phase), "Invalid BLIF cube or output value", context, rowLocation, "blif.cover-value");
    cubes.push(cube);
    phases.add(Number(phase));
  }
  requireAig(phases.size <= 1, "Mixed ON/OFF BLIF covers are unsupported", context, location, "blif.cover-phase");
  const phase = [...phases][0] ?? 1;
  const assignments = Array.from({ length: 1 << size }, (_, bits) => Array.from({ length: size }, (_, slot) => (bits >> (size - slot - 1)) & 1));
  const values = assignments.map((bits) => cubes.some((cube) => [...cube].every((character, slot) => character === "-" || Number(character) === bits[slot])) ? phase : 1 - phase);
  if (values.every((value) => value === values[0])) return { kind: "constant", value: values[0] };
  for (let slot = 0; slot < size; slot++) for (const inverted of [false, true]) {
    if (values.every((value, index) => value === (assignments[index][slot] ^ Number(inverted)))) return { kind: "alias", literals: [{ slot, inverted }] };
  }
  if (size === 2) for (const outputInverted of [false, true]) for (const first of [false, true]) for (const second of [false, true]) {
    if (values.every((value, index) => value === (((assignments[index][0] ^ Number(first)) & (assignments[index][1] ^ Number(second))) ^ Number(outputInverted)))) {
      return { kind: "and", outputInverted, literals: [{ slot: 0, inverted: first }, { slot: 1, inverted: second }] };
    }
  }
  // After constants, literals and single ANDs, only XOR and XNOR remain.
  return { kind: "parity", outputInverted: values[0] === 1 };
}

function checkNames(ports, kind, context) {
  const names = new Set();
  for (const port of ports) {
    requireAig(!names.has(port.name), `Duplicate ${kind} name '${port.name}'`, context, port);
    names.add(port.name);
  }
}

function decodeLabel(value, id) {
  return value.replace(/\\([Nnlr\\])/g, (_, escaped) => escaped === "N" ? id : escaped === "\\" ? "\\" : "\n");
}
