import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseLiberty } from "../src/parser/liberty_parser.js";
import { buildLibertyModel } from "../src/infer/liberty_model.js";
import { parseVerilog } from "../src/parser/verilogParser.js";
import { buildSchematicGraph } from "../src/netlist/graph.js";
import { getPinNetReferences } from "../src/netlist/model.js";

const [manifestPath, reportPath] = process.argv.slice(2);
if (!manifestPath || !reportPath) throw new Error("Usage: node tools/test_liberty_synthesis.mjs manifest.json report.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.notEqual(manifest.complete, false, "Synthesis run is still incomplete");
assert.equal(manifest.cases.length, manifest.expectedCases ?? manifest.cases.length, "Synthesis case count differs");
const libraries = new Map();
const sha = (text) => createHash("sha256").update(text).digest("hex");
for (const entry of manifest.libraries) {
  console.error(`Reading library ${entry.name}`);
  const source = await readFile(entry.path, "utf8");
  assert.equal(sha(source), entry.sha256, `Library changed: ${entry.name}`);
  libraries.set(entry.name, buildLibertyModel(parseLiberty(source, { name: entry.path })));
}
const results = [];
for (const entry of manifest.cases) {
  const result = { name: entry.name, library: entry.library, status: "failed" };
  try {
    console.error(`Checking ${entry.library}/${entry.name}: Verilog`);
    assert.equal(entry.status, "passed", "Synthesis did not pass");
    const [source, json] = await Promise.all([readFile(entry.netlist, "utf8"), readFile(entry.design, "utf8")]);
    assert.equal(sha(source), entry.netlistSha256, "Netlist hash changed");
    assert.equal(sha(json), entry.designSha256, "Yosys JSON hash changed");
    const oracle = JSON.parse(json).modules[manifest.top];
    assert.ok(oracle, "Yosys top module missing");
    const design = parseVerilog(source);
    const module = design.modules.find((item) => item.name === manifest.top);
    assert.ok(module, "Verilog top module missing");
    assert.equal(module.diagnostics.length, 0, "Verilog diagnostics");
    const library = libraries.get(entry.library);
    console.error(`Checking ${entry.library}/${entry.name}: graph`);
    const graph = buildSchematicGraph(module, { cellLibrary: library });
    assert.equal(graph.diagnostics.length, 0, `Graph diagnostics: ${JSON.stringify(graph.diagnostics.slice(0, 3))}`);
    const expectedCells = Object.entries(oracle.cells);
    console.error(`Checking ${entry.library}/${entry.name}: ${expectedCells.length} cells`);
    assert.equal(module.cells.length, expectedCells.length, "Cell count differs");
    const actualCells = new Map(module.cells.map((cell) => [cell.instance, cell]));
    const nodes = new Map(graph.nodes.filter((node) => node.kind === "cell").map((node) => [node.ref.instance, node]));
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    assert.deepEqual([...actualCells.keys()].sort(), Object.keys(oracle.cells).sort(), "Verilog/JSON instance names differ; export with write_verilog -norename");
    const nets = new Map();
    for (const [name, net] of Object.entries(oracle.netnames)) {
      nets.set(name, [...net.bits].reverse());
      net.bits.forEach((bit, index) => {
        const ordinal = (net.offset || 0) + (net.upto ? net.bits.length - 1 - index : index);
        nets.set(`${name}[${ordinal}]`, [bit]);
      });
    }
    const incoming = new Map();
    for (const edge of graph.edges) {
      const target = byId.get(edge.target), sourceNode = byId.get(edge.source);
      if (target?.kind === "cell") {
        const terminal = `${target.ref.instance}.${edge.targetPin}`;
        incoming.set(terminal, (incoming.get(terminal) || 0) + 1);
        assert.ok(["input", "inout"].includes(oracle.cells[target.ref.instance].port_directions[edge.targetPin]), `Non-input edge target ${terminal}`);
      }
      if (sourceNode?.kind === "cell") {
        assert.ok(["output", "inout"].includes(oracle.cells[sourceNode.ref.instance].port_directions[edge.sourcePin]), `Non-output edge source ${sourceNode.ref.instance}.${edge.sourcePin}`);
      }
      if (target?.kind === "cell" && sourceNode?.kind === "cell") {
        const sourceBits = oracle.cells[sourceNode.ref.instance].connections[edge.sourcePin];
        const targetBits = oracle.cells[target.ref.instance].connections[edge.targetPin];
        assert.ok(sourceBits.some((bit) => targetBits.includes(bit)), `Edge connects different Yosys net bits: ${edge.id}`);
      }
    }
    let pins = 0;
    const usedTypes = new Set(), kinds = {};
    for (const [instance, expected] of expectedCells) {
      const cell = actualCells.get(instance), node = nodes.get(instance);
      assert.ok(cell && node, `Missing instance ${instance}`);
      assert.equal(cell.type, expected.type, `${instance} type`);
      assert.ok(Object.hasOwn(library.cells, cell.type), `${cell.type} absent from matching library`);
      assert.equal(node.inferenceSource, "library", `${instance} gate provenance`);
      usedTypes.add(cell.type);
      kinds[node.gateKind] = (kinds[node.gateKind] || 0) + 1;
      const actualPins = new Map(cell.pins.map((pin) => [pin.pin, pin]));
      for (const pin of cell.pins) assert.ok(Object.hasOwn(expected.connections, pin.pin), `${instance}.${pin.pin} extra parsed pin`);
      for (const [pinName, bits] of Object.entries(expected.connections)) {
        const pin = actualPins.get(pinName);
        if (!bits.length && !pin) continue; // An omitted unconnected output is not a data terminal.
        assert.ok(pin, `${instance}.${pinName} missing pin`);
        const actual = getPinNetReferences(pin).flatMap((reference) => bitsMsbFirst(reference.name, nets)).reverse();
        assert.deepEqual(actual, bits, `${instance}.${pinName} connection bits`);
        const direction = node.pinDirections[pin.pinDisplayName || pinName];
        assert.equal(direction.direction, expected.port_directions[pinName], `${instance}.${pinName} direction`);
        assert.equal(direction.source, "library", `${instance}.${pinName} provenance`);
        if (bits.length && direction.direction === "input") assert.ok(incoming.has(`${instance}.${pinName}`), `${instance}.${pinName} lost incoming edge`);
        pins += 1;
      }
    }
    assert.ok(!graph.nodes.some((node) => node.kind === "implicit"), "Unexpected implicit net drivers");
    Object.assign(result, { status: "passed", cells: expectedCells.length, pins, edges: graph.edges.length,
      usedTypes: [...usedTypes].sort(), kinds, diagnostics: graph.diagnostics.length });
  } catch (error) { result.error = error.message; }
  results.push(result);
  console.log(JSON.stringify({ name: result.name, library: result.library, status: result.status, cells: result.cells, pins: result.pins, error: result.error }));
}
const report = { manifest: manifestPath, cases: results.length, failed: results.filter((item) => item.status !== "passed").length,
  totalCells: results.reduce((sum, item) => sum + (item.cells || 0), 0), totalPins: results.reduce((sum, item) => sum + (item.pins || 0), 0), results };
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ cases: report.cases, failed: report.failed, totalCells: report.totalCells, totalPins: report.totalPins }));
if (report.failed) process.exitCode = 1;

function bitsMsbFirst(name, nets) {
  if (nets.has(name)) return nets.get(name);
  const literal = name.match(/^(\d+)'([bhd])([0-9a-fxz_]+)$/i);
  if (!literal) throw new Error(`Unknown reference ${name}`);
  const [, widthText, baseText, digitsText] = literal;
  const width = Number(widthText), base = baseText.toLowerCase(), digits = digitsText.replaceAll("_", "").toLowerCase();
  if (/^[xz]+$/.test(digits)) return Array(width).fill(digits[0]);
  let binary = base === "b" ? digits : BigInt((base === "h" ? "0x" : "") + digits).toString(2);
  binary = binary.padStart(width, "0").slice(-width);
  return [...binary];
}
