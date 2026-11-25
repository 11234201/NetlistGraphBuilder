import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAig } from "../../src/domains/aig/aig_analysis.js";
import { queryAigView, restoreAigFocus } from "../../src/domains/aig/aig_view_query.js";
import { DEFAULT_FOCUSED_VIEW_POLICY } from "../../src/foundation/view_policy.js";
import { createDomainWorkspaceDiagnostics } from "../../src/app/domain_workspace_diagnostics.js";

test("high fanout remains bounded, shows real cut polarity and stays stable under source permutations", () => {
  const pi = { id: "pi", label: "driver", primaryNameMapping: { signalId: "n8", name: "rtl/driver" }, sourceRefs: [], kind: "pi", level: 0 };
  const outputs = Array.from({ length: 800 }, (_, id) => ({ id: `po${id}`, kind: "po", level: 0, label: `output ${id}`, sourceRefs: [] }));
  const edges = outputs.map((node, id) => ({ id: `e${id}`, slot: 0, source: "pi", target: node.id, inverted: id % 2 === 0, sourceRefs: [] }));
  const model = { nodes: [pi, ...outputs], edges };
  const imported = (model) => ({ documentId: "fanout", model: { model, analysis: analyzeAig(model) } });
  const focus = { mode: "focused", rootNodeIds: ["pi"], faninDepth: 0, fanoutDepth: 1 };
  const view = queryAigView(imported(model), focus);
  assert.equal(view.truncated, true);
  assert.equal(view.analysisModel.nodes.length, DEFAULT_FOCUSED_VIEW_POLICY.maximumVisibleNodes);
  assert.equal(view.hiddenEndpointCount, model.nodes.length - view.analysisModel.nodes.length);
  assert.equal(view.analysisModel.edges.length, view.analysisModel.nodes.length - 1);
  const cuts = view.model.nodes.filter((node) => node.kind === "boundary");
  assert.equal(cuts.length, 2);
  for (const node of cuts) {
    assert.match(node.label, /rtl\/driver/);
    assert.match(node.description, /budget boundary/);
    assert.match(node.label, /driver ×\d+/);
    const edge = view.model.edges.find((edge) => edge.target === node.id);
    assert.equal(edge.inverted, node.description.includes("inverted"));
  }
  const reverse = queryAigView(imported({ nodes: [...model.nodes].reverse(), edges: [...model.edges].reverse() }), focus);
  assert.equal(view.analysisScopeId, reverse.analysisScopeId);
  assert.deepEqual(view.model, reverse.model);
  assert.ok(view.analysisScopeLabel.length < 80);
  const roots = restoreAigFocus(imported(model), "whole", { focusedRootNodeIds: outputs.map((node) => node.id) });
  assert.equal(roots.focusedRootRefs.length, DEFAULT_FOCUSED_VIEW_POLICY.maximumRoots);
});

test("workspace diagnostic reporting keeps the original error, deduplicates quota warnings, and isolates sink failures", () => {
  const records = [];
  let ws = { analysisModel: { nodes: [{}], edges: [] }, sessionId: "s", analysisScopeLabel: "whole",
    document: { documentId: "doc", sourceRevision: 4, domainId: "aig" } };
  const diag = createDomainWorkspaceDiagnostics({ readWorkspace: () => ws, readSession: () => ({ viewMode: "whole" }),
    setStatus() {}, logProcess(...args) { records.push(args); throw new Error("broken log sink"); } });
  const original = new Error("quota", { cause: new Error("storage unavailable") });
  diag.saveFailed(original); diag.saveFailed(original);
  assert.equal(records.length, 1);
  assert.equal(records[0][3].error, original);
  assert.equal(records[0][3].documentRevision, 4);
  assert.equal(records[0][3].viewScopeId, "whole");
  diag.saved(); diag.saveFailed(original);
  ws = { ...ws, document: { ...ws.document, documentId: "different" } };
  diag.saveFailed(original);
  assert.equal(records.length, 3);
  diag.failure(null, "layout", "aig.focused.layout", { retainedPreviousView: true });
  assert.equal(records[3][3].error, null);
  assert.equal(records[3][3].code, "aig.focused.layout.failed");
  assert.equal(records[3][3].retainedPreviousView, true);
});
