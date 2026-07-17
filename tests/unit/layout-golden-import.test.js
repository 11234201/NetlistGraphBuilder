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
} from "../../src/layout/layoutGolden.js";
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
        coneDepth: 5,
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
  assert.equal(imported.layoutPolicy.spacing.wireLanePitch, 48);
  assert.equal(imported.layoutPolicy.features.alignDrivenLinks, false);
  assert.equal(imported.graphOverrides.nodeProperties["cell:u0"].label, "renamed");
  assert.deepEqual(imported.timingBadgeChoices.u0, [{ pin: "Y", metric: "at" }]);
  assert.deepEqual(imported.timingBadgePositions, { u0: "top-left" });
  assert.equal(imported.display.viewMode, "fanin");
  assert.equal(imported.display.coneDepth, 5);
  assert.equal(imported.display.useFanoutHubs, false);
  assert.equal(imported.display.expandedGroupIds.has("group:cells-0-49"), true);

  source.layoutOptions.graphOverrides.nodeProperties["cell:u0"].label = "changed";
  assert.equal(imported.graphOverrides.nodeProperties["cell:u0"].label, "renamed");

  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  applyLayoutGoldenState(state, imported);
  assert.deepEqual(state.nodePositions.get("cell:u0"), { x: 160, y: 20 });
  assert.equal(state.viewMode, "fanin");
  assert.equal(state.coneRootNodeId, "cell:u0");
  assert.equal(state.useFanoutHubs, false);
  assert.equal(state.expandedGroupIds.has("group:cells-0-49"), true);
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
