import assert from "node:assert/strict";
import test from "node:test";
import { createAppState } from "../../src/app/appState.js";
import {
  applyLayoutGoldenState,
  resolveLayoutGoldenModule
} from "../../src/app/layoutGoldenImport.js";
import {
  getLayoutGoldenState,
  parseLayoutGolden
} from "../../src/domains/netlist/layout_golden.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";

test("layout Golden import restores bounded layout and display state", () => {
  const source = {
    kind: "netlist-layout-golden",
    version: 2,
    moduleName: "top",
    nodes: [
      { id: "input:a", x: 10, y: 20, width: 80, height: 36 },
      { id: "cell:u0", x: 160, y: 20, width: 120, height: 72 }
    ],
    layoutOptions: {
      layoutPolicy: {
        name: "imported",
        spacing: { wireLanePitch: 999 },
        features: { alignDrivenLinks: false }
      },
      graphOverrides: {
        nodeProperties: { "cell:u0": { label: "renamed" } },
        cellPinDirections: { "cell:u0": { S: "top" } }
      },
      timingBadgeChoices: { u0: [{ pin: "Y", metric: "at" }] },
      timingBadgePositions: { u0: "top-left", invalid: 42 },
        display: {
          viewMode: "fanin",
          coneRootNodeId: "cell:u0",
          focusedRootNodeIds: ["cell:u1", "cell:u0"],
          focusedRootRefs: [{
            documentId: "document:primary",
            unitId: "top",
            kind: "cell",
            localId: "u1",
            occurrencePath: ["u_right"]
          }],
          activeFocusedRootNodeId: "cell:u1",
        coneDepth: 5,
        faninDepth: 0,
        fanoutDepth: 7,
        useFanoutHubs: false,
        collapseLargeGroups: true,
        expandedGroupIds: ["group:cells-0-49"]
      }
    }
  };

  const imported = getLayoutGoldenState(JSON.stringify(source));

  assert.equal(imported.moduleName, "top");
  assert.deepEqual(imported.nodePositions.get("cell:u0"), { x: 160, y: 20 });
  assert.deepEqual(imported.nodeSizes.get("input:a"), { width: 80, height: 36 });
  assert.equal(imported.layoutPolicy.spacing.wireLanePitch, 96);
  assert.equal(imported.layoutPolicy.features.alignDrivenLinks, false);
  assert.equal(imported.graphOverrides.nodeProperties["cell:u0"].label, "renamed");
  assert.deepEqual(imported.timingBadgeChoices.u0, [{ pin: "Y", metric: "at" }]);
  assert.deepEqual(imported.timingBadgePositions, { u0: "top-left" });
  assert.equal(imported.display.viewMode, "fanin");
  assert.deepEqual(imported.display.focusedRootNodeIds, ["cell:u0", "cell:u1"]);
  assert.deepEqual(imported.display.focusedRootRefs[0].occurrencePath, ["u_right"]);
  assert.equal(imported.display.activeFocusedRootNodeId, "cell:u1");
  assert.equal(imported.display.coneDepth, 5);
  assert.equal(imported.display.faninDepth, 0);
  assert.equal(imported.display.fanoutDepth, 7);
  assert.equal(imported.display.useFanoutHubs, false);
  assert.equal(imported.display.expandedGroupIds.has("group:cells-0-49"), true);

  source.layoutOptions.graphOverrides.nodeProperties["cell:u0"].label = "changed";
  assert.equal(imported.graphOverrides.nodeProperties["cell:u0"].label, "renamed");

  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  applyLayoutGoldenState(state, imported);
  assert.deepEqual(state.nodePositions.get("cell:u0"), { x: 160, y: 20 });
  assert.equal(state.viewMode, "focused");
  assert.equal(state.coneRootNodeId, "cell:u0");
  assert.equal(state.activeFocusedRootNodeId, "cell:u1");
  assert.deepEqual(state.focusedRootRefs[0].occurrencePath, ["u_right"]);
  assert.equal(state.faninDepth, 0);
  assert.equal(state.fanoutDepth, 7);
  assert.equal(state.useFanoutHubs, false);
  assert.equal(state.collapseLargeGroups, false);
  assert.equal(state.expandedGroupIds.size, 0);
  assert.equal(resolveLayoutGoldenModule({ modules: [{ name: "top" }] }, imported).name, "top");
});

test("layout Golden import rejects unrelated or unusable JSON", () => {
  assert.throws(
    () => parseLayoutGolden("not-json"),
    /Invalid Golden JSON/
  );
  assert.throws(
    () => parseLayoutGolden({ kind: "other", version: 2, moduleName: "top", nodes: [] }),
    /Not a Netlist Graph Builder/
  );
  assert.throws(
    () => getLayoutGoldenState({
      kind: "netlist-layout-golden",
      version: 2,
      moduleName: "top",
      nodes: [{ id: "cell:u0", x: "bad", y: 0 }]
    }),
    /valid node positions/
  );
  assert.throws(
    () => resolveLayoutGoldenModule({ modules: [{ name: "other" }] }, { moduleName: "top" }),
    /load its Verilog netlist first/
  );
});

test("Golden v1/v2 remain compatible while v3 rejects a different source", () => {
  for (const version of [1, 2]) {
    const imported = getLayoutGoldenState({
      kind: "netlist-layout-golden",
      version,
      moduleName: "top",
      nodes: [{ id: "cell:u0", x: 1, y: 2 }]
    });
    assert.equal(resolveLayoutGoldenModule({ modules: [{ name: "top" }] }, imported, {
      domainId: "netlist",
      documentId: "current"
    }).name, "top");
  }

  const imported = getLayoutGoldenState({
    kind: "netlist-layout-golden",
    version: 3,
    domainId: "netlist",
    documentId: "netlist:old",
    unitId: "top",
    sourceIdentity: { name: "old.v", size: 100 },
    moduleName: "top",
    nodes: [{ id: "cell:u0", x: 1, y: 2 }]
  });
  assert.throws(() => resolveLayoutGoldenModule({ modules: [{ name: "top" }] }, imported, {
    domainId: "netlist",
    documentId: "netlist:new",
    sourceIdentity: { name: "new.v", size: 100 }
  }), /another document/);
});

test("Golden v3 restores current Focused modes and fingerprints source content", () => {
  const focused = getLayoutGoldenState({
    kind: "netlist-layout-golden",
    version: 3,
    domainId: "netlist",
    documentId: "document:primary",
    unitId: "top",
    sourceIdentity: { name: "same.v", size: 4, fingerprint: "fnv1a32:aaaa0000" },
    moduleName: "top",
    nodes: [{ id: "cell:u0", x: 1, y: 2 }],
    layoutOptions: { display: {
      viewMode: "focused",
      focusedRootNodeIds: ["cell:u0"],
      activeFocusedRootNodeId: "cell:u0"
    } }
  });
  assert.equal(focused.display.viewMode, "focused");
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  applyLayoutGoldenState(state, focused);
  assert.equal(state.viewMode, "focused");
  assert.deepEqual(state.focusedRootNodeIds, ["cell:u0"]);
  assert.deepEqual(state.focusedRootRefs, []);
  assert.throws(() => resolveLayoutGoldenModule({ modules: [{ name: "top" }] }, focused, {
    domainId: "netlist",
    documentId: "document:primary",
    sourceIdentity: { name: "same.v", size: 4, fingerprint: "fnv1a32:bbbb0000" }
  }), /another source/);
});

test("Search-first Golden display state restores without stale roots", () => {
  const imported = getLayoutGoldenState({
    kind: "netlist-layout-golden",
    version: 3,
    moduleName: "top",
    nodes: [{ id: "cell:u0", x: 1, y: 2 }],
    layoutOptions: { display: { viewMode: "search-first", focusedRootNodeIds: ["cell:stale"] } }
  });
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  applyLayoutGoldenState(state, imported);
  assert.equal(state.viewMode, "search-first");
  assert.deepEqual(state.focusedRootNodeIds, []);
});

test("Focused Golden without a usable root cannot retain stale focused state", () => {
  const imported = getLayoutGoldenState({
    kind: "netlist-layout-golden",
    version: 3,
    moduleName: "top",
    nodes: [{ id: "cell:u0", x: 1, y: 2 }],
    layoutOptions: { display: { viewMode: "focused" } }
  });
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.viewMode = "focused";
  state.focusedRootNodeIds = ["cell:stale"];
  state.activeFocusedRootNodeId = "cell:stale";

  applyLayoutGoldenState(state, imported);

  assert.equal(state.viewMode, "whole");
  assert.deepEqual(state.focusedRootNodeIds, []);
  assert.equal(state.activeFocusedRootNodeId, null);
});
