import assert from "node:assert/strict";
import test from "node:test";
import { renderObjectDetails, INSPECTION_ROW_PAGE_SIZE, INSPECTION_TARGET_PAGE_SIZE } from "../../src/ui/objectDetailsPanel.js";
import { renderTimingPanel } from "../../src/ui/timingPanel.js";
import { renderAdjustPanel } from "../../src/ui/adjustPanel.js";

function connection(index) {
  return { pin: `pin-${index}`, direction: "input", net: `n${index}`, netTarget: { kind: "net", name: `n${index}` },
    peerTargets: [{ kind: "node", id: `cell:u${index}`, label: `u${index}.Y` }] };
}

test("inspector paginates long connections without truncating the source inspection", () => {
  const inspection = { kind: "cell", summary: [["Kind", "cell"], ["Label", "u"]],
    connections: Object.freeze(Array.from({ length: 205 }, (_, index) => Object.freeze(connection(index)))) };
  const first = renderObjectDetails(inspection);
  assert.equal((first.match(/<tr>/g) || []).length, INSPECTION_ROW_PAGE_SIZE + 1);
  assert.match(first, /data-selection-target-id="cell:u99"/);
  assert.doesNotMatch(first, /data-selection-target-id="cell:u100"/);
  assert.match(first, /data-inspection-page-group="connections" data-inspection-page="1"/);
  const last = renderObjectDetails(inspection, { pages: { connections: 2 } });
  assert.match(last, /data-selection-target-id="cell:u204"/);
  assert.doesNotMatch(last, /data-selection-target-id="cell:u199"/);
  assert.match(last, /201–205 of 205/);
  assert.equal(inspection.connections.length, 205);
});

test("a single high-fanout pin and traversal list also have bounded target pages", () => {
  const targets = Object.freeze(Array.from({ length: 30 }, (_, index) => ({ kind: "node", id: `cell:peer${index}`, label: `peer${index}` })));
  const inspection = { kind: "cell", summary: [["Label", "u"]],
    connections: [{ pin: "Y", direction: "output", net: "n", peerTargets: targets }],
    traversal: [{ label: "Fanout", immediate: targets.map((target) => target.label), immediateTargets: targets, transitiveCount: 30, maxDepth: 1 }] };
  const first = renderObjectDetails(inspection);
  assert.equal((first.match(/data-selection-target-id=/g) || []).length, INSPECTION_TARGET_PAGE_SIZE * 2);
  assert.doesNotMatch(first, /data-selection-target-id="cell:peer20"/);
  const later = renderObjectDetails(inspection, { pages: { "peers:0": 1, "traversal:0": 1 } });
  assert.match(later, /data-selection-target-id="cell:peer29"/);
  assert.doesNotMatch(later, /data-selection-target-id="cell:peer19"/);
  assert.equal(targets.length, 30);
});

test("inspector exposes full escaped display and canonical names with selection scope", () => {
  const canonicalName = 'top/instance/<img src=x onerror="bad">';
  const html = renderObjectDetails({ kind: "cell", summary: [["Label", "Shown name"], ["Inference", "library"]], connections: [] }, {
    canonicalName, label: "Shown name", scope: "B · Compare · module", identity: JSON.stringify(["right", canonicalName])
  });
  assert.match(html, /data-inspector-summary/);
  assert.match(html, /data-selection-identity=/);
  assert.match(html, /data-inspector-copy="top\/instance\/&lt;img/);
  assert.match(html, /Canonical name/);
  assert.match(html, /B · Compare · module/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /data-inspector-section="connections"/);
});

test("net summary does not repeat an unbounded load-name list above paginated connections", () => {
  const inspection = { kind: "net", summary: [["Name", "clk"], ["Loads", "unbounded raw load list"], ["Driver", "u0.Y"]],
    connections: [{ ...connection(0), pin: "driver" }, { ...connection(1), pin: "load" }] };
  const html = renderObjectDetails(inspection);
  assert.doesNotMatch(html, /unbounded raw load list/);
  assert.match(html, /1 connection\(s\); see Connections/);
  assert.match(html, /data-selection-target-id="cell:u1"/);
});

test("timing and instance editing remain scoped sections with their existing controls", () => {
  const node = { kind: "cell", label: "u0", width: 80, height: 40, ref: { pins: [] },
    timing: { worstPin: "Y", worstSlack: -0.1, pins: { Y: { pin: "Y", at: 1, rt: 0.9, slack: -0.1 } } } };
  const timing = renderTimingPanel(node, [{ pin: "Y", metric: "slack" }]);
  assert.match(timing, /data-inspector-section="timing"/);
  assert.match(timing, /class="timing-table-wrap"/);
  assert.match(timing, /data-timing-pin="Y" data-timing-metric="slack" checked/);
  assert.match(timing, /id="resetTimingBadgeButton"/);
  assert.match(renderAdjustPanel(node, true), /data-inspector-section="adjust"/);
  assert.equal(renderAdjustPanel(node, false), "");
});
