export const aigControls = Object.freeze({
  domainId: "aig",
  toolbar: `<span class="context-note">Graphviz · AIG</span>
    <label><input type="checkbox" data-domain-policy="critical" checked>Logical critical path</label>
    <label><input type="checkbox" data-domain-policy="fanout" checked>High fanout</label>
    <label>≥ <input type="number" data-domain-policy="fanoutThreshold" min="1" max="1000000" value="2" aria-label="High fanout threshold"></label>
    <span class="context-note">Red: critical · Orange: fanout · Dashed: inverted</span>`,
  unavailableControls: ["compareButton", "focusedViewButton", "viewMenu", "layoutMenu", "timingMenu", "adjustLayoutButton",
    "libertyMenu", "cellConfigMenu", "timingInput", "pasteTimingButton", "saveGoldenButton", "goldenInput",
    "addFocusedRootButton", "setFocusedRootButton", "editCellDefinitionButton", "moduleBackButton", "moduleForwardButton",
    "diagnosticsDrawer", "toggleDiagnosticsButton"],
  searchPlaceholder: "Find AIG name or source ID…"
});
