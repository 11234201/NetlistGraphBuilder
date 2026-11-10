import assert from "node:assert/strict";
import test from "node:test";
import { parseLiberty, parseLibertySteps } from "../../src/parser/liberty_parser.js";
import { buildLibertyModel } from "../../src/infer/liberty_model.js";
import { analyzeLibertyFunction } from "../../src/infer/liberty_function.js";
import { createLibertyLibraryService } from "../../src/domains/netlist/liberty_import.js";
import { runCooperativeTask } from "../../src/application/cooperative_task.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import { buildSchematicGraph } from "../../src/netlist/graph.js";
import { createModuleConnectivityTemplate, projectHierarchicalRenderGraph } from "../../src/domains/netlist/hierarchy_connectivity.js";
import { resolveCellSemantics } from "../../src/infer/cell_semantics.js";
import { createWorkspaceArtifactCache } from "../../src/app/workspaceArtifactCache.js";
import { buildModuleWorkspace } from "../../src/app/moduleWorkspace.js";
import { prepareCompareWorkspace } from "../../src/app/compareWorkspace.js";
import { getLayoutProvider } from "../../src/layout/layoutProvider.js";
import { netlistFeature } from "../../src/domains/netlist/netlist_feature.js";

const source = `library(demo) {
  cell(ODD) { pin(RESULT) { direction: output; function: "!(X * Y)"; }
    pin(X) { direction: input; } pin(Y) { direction: input; }
    timing() { nested() { values("1, 2, 3 { /* } "); } }
  }
}`;
const read = (text = source) => buildLibertyModel(parseLiberty(text, { name: "demo.lib" }));

test("Liberty reader preserves interface, source locations and skips nested timing data", () => {
  const result = read();
  assert.equal(result.cells.ODD.pins.RESULT.direction, "output");
  assert.equal(result.cells.ODD.logic.kind, "nand");
  assert.equal(result.cells.ODD.pins.RESULT.span.start.line, 2);
  assert.equal(result.cells.ODD.sourceName, "demo.lib");
  assert.equal(JSON.stringify(result).includes("values"), false);
  assert.throws(() => { result.cells.ODD.pins.X.direction = "output"; }, TypeError);
});

test("Liberty lexical states handle comments, escaped quotes, CRLF and continuations", () => {
  const parsed = parseLiberty('/* { */ library("a\\\"b") {\r\ncell(C) { pin(A) {direction: input;} pin(Z) {direction: output; function: "A\\\r\n";} } // }\r\n}');
  assert.equal(parsed.libraries[0].args[0], 'a"b');
  assert.equal(buildLibertyModel(parsed).cells.C.logic.kind, "buf");
  assert.throws(() => parseLiberty('library(x) { /*'), /Unterminated comment/);
  assert.throws(() => parseLiberty('library(x) { cell(C) {'), /Unexpected end/);
  assert.throws(() => parseLiberty('library(x) { pin(A) {function: "bad'), /Unterminated string/);
  assert.throws(() => read('library(x) {include_file("other.lib");}'), /include_file/);
});

test("Liberty rejects duplicate cells and attributes, enforces limits and yields inside comments", () => {
  assert.throws(() => read(source + source.replace("demo", "other")), /Ambiguous cell/);
  assert.throws(() => read('library(x) {cell(C){pin(A){direction:input;direction:output;}}}'), /Duplicate attribute/);
  assert.throws(() => parseLiberty('library(x){' + 'g(){'.repeat(257) + '}'.repeat(258)), /maxDepth/);
  assert.throws(() => parseLiberty('library(x){a:"' + 'a'.repeat(1048577) + '";}'), /maxToken/);
  assert.throws(() => parseLiberty(" ".repeat(64 * 1024 * 1024 + 1)), /maxBytes/);
  const unicode = 'library("中文😀"){}';
  assert.equal(parseLiberty(unicode).sizeBytes, new TextEncoder().encode(unicode).length);
  assert.throws(() => read('library(x){cell(C){' + Array.from({ length: 1001 }, (_, index) => `pin(P${index}){}`).join("") + '}}'), /maxDiagnostics/);
  const steps = parseLibertySteps('/*' + ' '.repeat(200000) + '*/library(x){}');
  assert.equal(steps.next().done, false);
  assert.throws(() => read('library(x){cell(__proto__){pin(constructor){direction:input;}}cell(__proto__){}}'), /Ambiguous cell/);
});

test("Liberty validates parentheses in retained and skipped simple attributes", async () => {
  for (const body of ["nom_voltage: (1;", "nom_voltage: 1);", "unknown: (1;", "unknown = 1);"])
    assert.throws(() => parseLiberty(`library(x){${body}}`), /Incomplete statement|Unexpected '\)'/);
  assert.throws(() => parseLiberty(`library(x){unknown: ${"(".repeat(257)}1${")".repeat(257)};}`), /maxDepth/);
  assert.equal(read('library(x){cell(B){pin(A){direction:input;}pin(Z){direction:output;function:(A);}}}').cells.B.logic.kind, "buf");
  const service = createLibertyLibraryService({ execute: runCooperativeTask });
  const original = await service.importText(source);
  await assert.rejects(service.importText('library(bad){unknown:(1;}'), /Incomplete statement/);
  assert.equal(service.read(), original);
});

test("Liberty bus types resolve regardless of declaration order and preserve bit direction", () => {
  const result = read(`library(x) {cell(B){bus(A){bus_type:t; direction:input;} pin(Z){direction:output;}}
    type(t){base_type:array; data_type:bit; bit_width:2; bit_from:1; bit_to:0; downto:true;}}`);
  assert.deepEqual(result.cells.B.buses[0].members, ["A[1]", "A[0]"]);
  assert.equal(result.cells.B.pins.A.direction, "input");
  assert.equal(result.cells.B.pins["A[0]"].direction, "input");
  assert.throws(() => read('library(x){cell(B){bus(A){bus_type:missing;}}}'), /bus range/);
});

test("Liberty bus names remain literal when expanding naming style placeholders", () => {
  for (const name of ["A$&", "A$$", "A$'", "A$`", "A%d", "A%s"]) {
    const library = read(`library(x){type(t){bit_from:1;bit_to:0;}cell(C){bus(${JSON.stringify(name)}){bus_type:t;direction:output;}}}`);
    assert.deepEqual(library.cells.C.buses[0].members, [`${name}[1]`, `${name}[0]`]);
    const module = parseVerilog(`module top(output z); C u(.\\${name}[0] (z)); endmodule`).modules[0];
    const graph = buildSchematicGraph(module, { cellLibrary: library });
    assert.equal(graph.diagnostics.some((entry) => entry.code === "library-missing-pin"), false);
    const cell = graph.nodes.find((node) => node.id === "cell:u");
    assert.equal(Object.values(cell.pinDirections)[0].source, "library");
    assert.equal(Object.values(cell.pinDirections)[0].direction, "output");
  }
});

test("Liberty bus clock defaults reach bit pins, explicit members override them, and aggregate clocks stay conservative", () => {
  const library = read(`library(x){
    type(t){bit_from:1;bit_to:0;}
    cell(C){
      bus(CK){bus_type:t;direction:input;clock:true;}
      bus(MIX){bus_type:t;direction:input;clock:true;pin(MIX[1]){clock:false;}}
      bus(DATA){bus_type:t;direction:input;clock:false;pin(DATA[0]){clock:true;}}
    }
  }`);
  const expected = { CK: true, "CK[1]": true, "CK[0]": true,
    MIX: false, "MIX[1]": false, "MIX[0]": true,
    DATA: false, "DATA[1]": false, "DATA[0]": true };
  for (const [pin, clock] of Object.entries(expected)) assert.equal(library.cells.C.pins[pin].clock, clock, pin);
  const module = parseVerilog(`module top(input [1:0] c,m,d);
    C whole(.CK(c),.MIX(m),.DATA(d));
    C bits(.\\CK[1] (c[1]),.\\CK[0] (c[0]),.\\MIX[1] (m[1]),.\\MIX[0] (m[0]),.\\DATA[1] (d[1]),.\\DATA[0] (d[0]));
    endmodule`).modules[0];
  const graph = buildSchematicGraph(module, { cellLibrary: library });
  const template = createModuleConnectivityTemplate(module, new Map(), { cellLibrary: library });
  assert.deepEqual(graph.diagnostics, []);
  for (const node of graph.nodes.filter((item) => item.kind === "cell")) {
    for (const pin of node.ref.pins) {
      const info = node.pinDirections[pin.pinDisplayName || pin.pin];
      assert.equal(info.source, "library");
      assert.equal(info.direction, "input");
      assert.equal(info.role, expected[pin.pin] ? "clock" : undefined, pin.pin);
    }
    const hierarchical = template.cells.find((cell) => cell.instance === node.ref.instance);
    for (const pin of hierarchical.pins) assert.equal(pin.direction, node.pinDirections[pin.displayName].direction);
  }
});

test("uninterpreted bundle interfaces cannot produce a primitive symbol from a partial cell", () => {
  for (const sequential of [false, true]) {
    const library = read(`library(x){cell(C){
      pin(A){direction:input;}
      pin(Z){direction:output;function:${sequential ? "IQ" : "!A"};}
      ${sequential ? "ff(IQ,IQN){clocked_on:A;next_state:A;}" : ""}
      bundle(EXTRA){members(Y);direction:output;pin(Y){function:A;}}
    }}`);
    assert.equal(library.cells.C.logic.kind, "blackbox");
    assert.equal(library.cells.C.logic.status, "unsupported-bundle");
    assert.ok(library.diagnostics.some((item) => item.code === "unsupported-bundle"));
    const module = parseVerilog('module top(input a,output z,y); C u(.A(a),.Z(z),.Y(y)); endmodule').modules[0];
    const graph = buildSchematicGraph(module, { cellLibrary: library });
    const cell = graph.nodes.find((node) => node.id === "cell:u");
    assert.equal(cell.gateKind, "blackbox");
    assert.equal(cell.outputBubble, false);
    assert.equal(cell.pinDirections.Z.direction, "output");
    assert.equal(cell.pinDirections.Z.source, "library");
    assert.ok(graph.diagnostics.some((item) => item.code === "library-missing-pin" && item.pin === "Y"));
    const template = createModuleConnectivityTemplate(module, new Map(), { cellLibrary: library });
    assert.equal(template.cells[0].semantics.kind, "blackbox");
  }
});

test("Liberty rejects nameless signal, power and bus-member pin groups without replacing a valid library", async () => {
  const service = createLibertyLibraryService({ execute: runCooperativeTask });
  const original = await service.importText(source);
  const bodies = [
    "pin(){direction:input;}", "pg_pin(){pg_type:primary_power;}",
    "bus(A){bus_type:t;direction:input;pin(){direction:output;}}"
  ];
  for (const body of bodies) {
    await assert.rejects(service.importText(`library(bad){type(t){bit_from:0;bit_to:0;}cell(C){${body}}}`), /pin.*requires at least one name/i);
    assert.equal(service.read(), original);
  }
});

test("Liberty expression semantics cover precedence, implicit AND, postfix inversion and mux", () => {
  for (const expression of ["!(A * B)", "(A B)'", "!(A & B)"]) assert.equal(analyzeLibertyFunction(expression, ["A", "B"]).kind, "nand");
  assert.equal(analyzeLibertyFunction("!S A + S B", ["A", "B", "S"]).kind, "mux");
  assert.equal(analyzeLibertyFunction("(A ^ B)'", ["A", "B"]).kind, "xnor");
  assert.equal(analyzeLibertyFunction("A ^ B & A ^ B", ["A", "B"]).kind, "xor");
  const manyInputs = Array.from({ length: 9 }, (_, index) => `P${index}`);
  assert.equal(analyzeLibertyFunction(manyInputs.join(" & "), manyInputs).status, "unsupported");
  assert.equal(analyzeLibertyFunction("IQ", ["A"]).status, "unsupported");
  assert.equal(analyzeLibertyFunction("A +", ["A"]).status, "unsupported");
  assert.equal(analyzeLibertyFunction("(".repeat(70) + "A" + ")".repeat(70), ["A"]).status, "unsupported");
  assert.equal(read('library(x){cell(S){ff(IQ,IQN){next_state:D;clocked_on:CK;}pin(Q){direction:output;function:IQ;}}}').cells.S.logic.kind, "dff");
  assert.equal(read('library(x){cell(T){pin(A){direction:input;}pin(Z){direction:output;function:A;three_state:EN;}}}').cells.T.logic.kind, "blackbox");
});

test("Library directions are shared by graph and hierarchy, explicit overrides keep priority", () => {
  const design = parseVerilog('module top(input a,b, output z); ODD u(.X(a),.Y(b),.RESULT(z)); endmodule');
  const module = design.modules[0], library = read();
  const graph = buildSchematicGraph(module, { cellLibrary: library });
  const cell = graph.nodes.find((node) => node.ref?.instance === "u");
  assert.equal(cell.gateKind, "nand");
  assert.equal(cell.pinDirections.RESULT.source, "library");
  assert.equal(createModuleConnectivityTemplate(module, new Map(), { cellLibrary: library }).cells[0].pins.find((pin) => pin.name === "RESULT").direction, "output");
  const overridden = buildSchematicGraph(module, { cellLibrary: library, overrides: { cellPinDirections: { u: { X: "output" } } } });
  assert.equal(overridden.nodes.find((node) => node.ref?.instance === "u").pinDirections.X.source, "override");
  assert.equal(module.cells[0].pins[0].direction, undefined);
});

test("An empty Cell Config cannot shadow Liberty cells through prototype properties", () => {
  for (const name of ["constructor", "toString", "__proto__"]) {
    const library = read(`library(x){cell(${name}){pin(A){direction:input;}pin(Z){direction:output;function:A;}}}`);
    const module = parseVerilog(`module top(input a,output z); ${name} u(.A(a),.Z(z)); endmodule`).modules[0];
    const options = { cellLibrary: library, cellConfig: { cells: {} } };
    const graph = buildSchematicGraph(module, options);
    const cell = graph.nodes.find((node) => node.id === "cell:u");
    assert.equal(cell.gateKind, "buf");
    assert.equal(cell.inferenceSource, "library");
    assert.equal(createModuleConnectivityTemplate(module, new Map(), options).cells[0].semantics.source, "library");
  }
});

test("Library import atomically preserves old data on failure, cancels stale tasks and unloads", async () => {
  const service = createLibertyLibraryService({ execute: runCooperativeTask });
  const first = await service.importText(source);
  await assert.rejects(service.importText('library('));
  assert.equal(service.read(), first);
  const pending = service.importText('/*' + ' '.repeat(500000) + '*/' + source);
  service.cancel();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(service.read(), first);
  service.clear(); assert.equal(service.read(), null);
});

test("Library precedence is per field; explicit unknown and real module identity win", () => {
  const cell = { type: "ODD", instance: "u", pins: ["X", "Y", "RESULT"].map((pin) => ({ pin })) };
  const options = { cellLibrary: read(), cellConfig: { cells: { ODD: { gateKind: "OR", pins: { X: "unknown" } } } } };
  const result = resolveCellSemantics(cell, options);
  assert.equal(result.kind.kind, "or");
  assert.equal(result.pinDirections.X.direction, "unknown");
  assert.equal(result.pinDirections.X.source, "user-config");
  assert.equal(result.pinDirections.RESULT.source, "library");
  assert.ok(result.diagnostics.some((item) => item.code === "library-direction-conflict"));
  const overridden = resolveCellSemantics(cell, { ...options, overrides: { X: "output" } });
  assert.equal(overridden.pinDirections.X.source, "override");
  const module = resolveCellSemantics(cell, { ...options, overrides: { X: "output" },
    moduleDefinition: { name: "ODD", ports: [{ name: "X", direction: "input" }] } });
  assert.equal(module.kind.kind, "module");
  assert.equal(module.pinDirections.X.source, "module-definition");
  assert.equal(module.libraryCell, null);
  assert.ok(module.diagnostics.some((item) => item.code === "library-module-conflict"));
  const unknown = resolveCellSemantics({ type: "UNKNOWN", pins: [{ pin: "custom" }] }, { overrides: { custom: "unknown" } });
  assert.equal(unknown.pinDirections.custom.direction, "unknown");
  assert.equal(unknown.pinDirections.custom.source, "override");
});

test("Library missing interfaces diagnose fallback and power pins do not carry data edges", () => {
  const library = read('library(x){cell(P){pin(X){direction:input;}pin(Z){direction:output;function:X;}pg_pin(VDD){pg_type:primary_power;}}}');
  const module = parseVerilog('module top(input a,p,output z); P u(.X(a),.VDD(p),.Z(z),.MISSING(a)); endmodule').modules[0];
  const graph = buildSchematicGraph(module, { cellLibrary: library });
  assert.ok(graph.diagnostics.some((item) => item.code === "library-missing-pin"));
  assert.ok(!graph.edges.some((edge) => edge.targetPin === "VDD"));
  const template = createModuleConnectivityTemplate(module, new Map(), { cellLibrary: library });
  assert.ok(!template.cells[0].pins.some((pin) => pin.name === "VDD"));
  assert.ok(resolveCellSemantics({ type: "absent", pins: [] }, { cellLibrary: library }).diagnostics.some((item) => item.code === "library-missing-cell"));
  assert.throws(() => read('library(x){cell(C){pin(VDD){direction:input;}pg_pin(VDD){}}}'), /Duplicate/);
  const internal = read('library(x){cell(C){pin(IQ){direction:internal;}}}');
  assert.equal(internal.cells.C.pins.IQ.direction, "internal");
  const result = resolveCellSemantics({ type: "C", pins: [{ pin: "IQ" }] }, { cellLibrary: internal });
  assert.equal(result.pinDirections.IQ.role, "internal");
  assert.equal(result.pinDirections.IQ.direction, "unknown");
  assert.ok(result.diagnostics.some((item) => item.code === "library-internal-pin"));
});

test("Liberty model remains semantic-order invariant and conservative for complex cells", () => {
  const shape = (model) => JSON.parse(JSON.stringify(model.cells, (key, value) => key === "span" ? undefined : value));
  const first = read('library(x){cell(C){pin(A,B){direction:input;}pin(Z){function:"A B";direction:output;}}cell(T){pin(Q){direction:output;function:1;}}}');
  const second = read('library(x){cell(T){pin(Q){function:1;direction:output;}}cell(C){pin(Z){direction:output;function:"A B";}pin(B,A){direction:input;}}}');
  assert.deepEqual(shape(first), shape(second));
  assert.equal(first.cells.T.logic.kind, "blackbox");
  for (const body of [
    'latch(IQ,IQN){enable:E;data_in:D;}pin(Q){direction:output;function:IQ;}',
    'pin(A){direction:input;}pin(Z,Y){direction:output;function:A;}',
    'ff(IQ,IQN){clocked_on:CK;next_state:D;}pin(Q){direction:output;function:IQ;three_state:E;}'
  ]) assert.equal(read(`library(x){cell(C){${body}}}`).cells.C.logic.kind, "blackbox");
  assert.throws(() => read('library(x){cell(B){bus(A){bus_type:t;direction:input;}}type(t){bit_from:0;bit_to:1000000;}}'), /bus range/);
  assert.throws(() => read('library(x){cell(B){bus(A){bus_type:t;direction:input;pin(A[0]){direction:output;}}}type(t){bit_from:1;bit_to:0;}}'), /Mixed-direction/);
});

test("Library identity invalidates Single, Compare and hierarchy caches through Scene", () => {
  const source = 'module top(input a,b,output z); ODD u(.X(a),.Y(b),.RESULT(z)); endmodule';
  const document = netlistFeature.importSource({ name: "design.v", text: source });
  const module = document.model.modules[0];
  const library = read();
  const replacement = read('library(other){cell(ODD){pin(X){direction:output;function:"Y RESULT";}pin(Y,RESULT){direction:input;}}}');
  const options = { module, moduleLibrary: [module], artifactCache: createWorkspaceArtifactCache(),
    artifactIdentity: { documentId: document.documentId, sessionId: "single:primary", sourceRevision: 1 },
    layoutProvider: getLayoutProvider("simple-layered"), useFanoutHubs: false };
  const old = buildModuleWorkspace(options);
  const next = buildModuleWorkspace({ ...options, cellLibrary: library });
  assert.notEqual(next.fullGraph, old.fullGraph);
  assert.equal(buildModuleWorkspace({ ...options, cellLibrary: library }).fullGraph, next.fullGraph);
  assert.equal(next.fullGraph.nodes.find((node) => node.id === "cell:u").gateKind, "nand");
  assert.ok(next.scene);
  const compareOptions = { ...options, leftModule: module, rightModule: module, forceWhole: true };
  const compare = prepareCompareWorkspace({ ...compareOptions, cellLibrary: library });
  const updated = prepareCompareWorkspace({ ...compareOptions, cellLibrary: replacement });
  for (const side of ["left", "right"]) {
    assert.notEqual(compare.fullGraphs[side], updated.fullGraphs[side]);
    assert.equal(updated.fullGraphs[side].nodes.find((node) => node.id === "cell:u").pinDirections.X.direction, "output");
  }
  const root = { rootModuleName: "top", kind: "net", localId: "z" };
  const query = (cellLibrary) => netlistFeature.queryHierarchy(document, root, { cellLibrary, direction: "fanin" });
  assert.ok(query(library).nodes.some((node) => node.localId === "u"));
  assert.ok(!query(replacement).nodes.some((node) => node.localId === "u"));
  const projected = projectHierarchicalRenderGraph(query(library));
  assert.equal(projected.nodes.find((node) => node.localId === "u").gateKind, "nand");
  assert.equal(buildModuleWorkspace(options).fullGraph, old.fullGraph);
});

test("An obsolete import cannot replace a newer snapshot even if execution ignores abort", async () => {
  const release = [];
  const service = createLibertyLibraryService({ execute: async (steps) => {
    let result;
    do { result = steps.next(); } while (!result.done);
    await new Promise((resolve) => release.push(resolve));
    return result.value;
  } });
  const old = service.importText(source, { name: "old.lib" });
  const oldRejected = assert.rejects(old, { name: "AbortError" });
  const next = service.importText(source, { name: "new.lib" });
  release[1](); await next;
  release[0](); await oldRejected;
  assert.equal(service.read().sourceName, "new.lib");
});
