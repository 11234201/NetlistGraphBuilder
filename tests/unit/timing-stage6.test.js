import assert from "node:assert/strict";
import test from "node:test";
import { detectQuickInputKind } from "../../src/app/quickInput.js";
import {
  annotateGraphTiming,
  normalizeTimingDisplayPolicy,
  resolveTimingSnapshot
} from "../../src/timing/timingAnnotation.js";
import { parseTimingLog } from "../../src/timing/timingParser.js";
import { renderSchematicSvg } from "../../src/render/svgRenderer.js";

function makeBoundaryTiming() {
  const rows = (offset) => Array.from({ length: 20 }, (_, index) => {
    const direction = index < 12 ? "INPUT" : "OUTPUT";
    const name = index < 12 ? `in[${index}]` : `out[${index - 12}]`;
    return `${direction} ${(index + offset) / 10} ${(index + offset + 1) / 10} -${(index + 1) / 100} top/${name}`;
  }).join("\n");
  return `Module: top\nApply: None\ndirection at rat slack object\n[Global]\n${rows(0)}\n[Local]\n${rows(1)}`;
}

test("stage 6 boundary timing parses Global and Local into unified scopes", () => {
  const timing = parseTimingLog(makeBoundaryTiming());
  assert.equal(timing.format, "boundary-table");
  assert.equal(timing.scopes.length, 1);
  const scope = timing.scopes[0];
  assert.equal(scope.subject, "top");
  assert.equal(scope.scopeKind, "module");
  assert.equal(scope.apply, "None");
  assert.equal(scope.snapshots.global.length, 20);
  assert.equal(scope.snapshots.local.length, 20);
  assert.equal(scope.snapshots.global.filter((item) => item.direction === "input").length, 12);
  assert.equal(scope.snapshots.global.filter((item) => item.direction === "output").length, 8);
  assert.equal(scope.snapshots.global[0].rt, 0.1);
  assert.equal(resolveTimingSnapshot(scope, "auto"), "global");
  assert.equal(detectQuickInputKind(makeBoundaryTiming()), "timing");
});

test("boundary timing annotates module ports using the selected snapshot", () => {
  const timing = parseTimingLog(makeBoundaryTiming());
  const graph = {
    moduleName: "top",
    nodes: [
      { id: "input:in_0", kind: "input", label: "in[0]", ref: { name: "in[0]", displayName: "in[0]" } },
      { id: "output:out_0", kind: "output", label: "out[0]", ref: { name: "out[0]", displayName: "out[0]" } }
    ],
    edges: []
  };
  const global = annotateGraphTiming(graph, timing, { displayPolicy: { snapshot: "auto", metrics: ["slack"] } });
  const local = annotateGraphTiming(graph, timing, { displayPolicy: { snapshot: "local", metrics: ["at", "rt"] } });
  assert.equal(global.nodes[0].timing.snapshot, "global");
  assert.equal(global.nodes[0].timing.at, 0);
  assert.equal(local.nodes[0].timing.snapshot, "local");
  assert.equal(local.nodes[0].timing.at, 0.1);
  assert.deepEqual(normalizeTimingDisplayPolicy({ snapshot: "bad", metrics: ["rt", "rt", "bad"] }), {
    snapshot: "auto",
    metrics: ["rt"]
  });
});

test("legacy LocResyn timing remains compatible and accepts rat alias", () => {
  const timing = parseTimingLog("inst <top/u0> pin <A>, at 1.0, rat 0.1, slack -0.2");
  assert.equal(timing.kind, "locresyn-timing");
  assert.equal(timing.instances.u0.pins.A.rt, 0.1);
  assert.equal(timing.scopes[0].snapshots.global[0].rt, 0.1);
});

test("unknown Apply values are preserved and diagnosed without guessing Local", () => {
  const timing = parseTimingLog("Module: top\nApply: Maybe\n[Global]\nINPUT 1 2 3 a");
  assert.equal(timing.scopes[0].apply, "Maybe");
  assert.match(timing.diagnostics[0].message, /Unknown Apply/);
  assert.equal(resolveTimingSnapshot(timing.scopes[0], "auto"), "global");
});

test("header-driven timing accepts a scope adjacent to snapshot and preserves future columns", () => {
  const timing = parseTimingLog(`direction at rat slack slew [Global]ConeKernel_co_l_resyn2_u_gen_13823_000018_gen_14909
-------------------------------------------------------------------
0.311245 -0.017425 -0.328670 0.044 ModuleFull/ConeKernel_co_l_resyn2_u_gen_13823_000018_gen_14909/w_gen_14670`);
  assert.equal(timing.scopes.length, 1);
  assert.equal(timing.scopes[0].subject, "ConeKernel_co_l_resyn2_u_gen_13823_000018_gen_14909");
  const record = timing.scopes[0].snapshots.global[0];
  assert.equal(record.at, 0.311245);
  assert.equal(record.rt, -0.017425);
  assert.equal(record.slack, -0.32867);
  assert.equal(record.metrics.slew, 0.044);
  assert.equal(record.objectName, "w_gen_14670");
  const annotated = annotateGraphTiming({
    moduleName: timing.scopes[0].subject,
    nodes: [{ id: "input:w", kind: "input", label: "w_gen_14670", ref: { name: "w_gen_14670" }, x: 0, y: 0, width: 80, height: 30 }],
    edges: [], bounds: { x: 0, y: 0, width: 100, height: 50 }
  }, timing);
  assert.match(renderSchematicSvg(annotated), /slew 0\.044/);
});
