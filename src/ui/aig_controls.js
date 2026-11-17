export const aigControls = Object.freeze({
  domainId: "aig",
  toolbar: `<span class="context-note">Graphviz · AIG</span>
    <label>View <select data-domain-policy="viewStyle" aria-label="AIG view style"><option value="standard">Standard</option><option value="abc">ABC</option></select></label>
    <label><input type="checkbox" data-domain-policy="neighbors" checked>Highlight neighbors</label>
    <label><input type="checkbox" data-domain-policy="critical" checked>Logical critical path</label>
    <label><input type="checkbox" data-domain-policy="fanout" checked>High fanout</label>
    <label>≥ <input type="number" data-domain-policy="fanoutThreshold" min="1" max="1000000" value="2" aria-label="High fanout threshold"></label>
    <span class="context-note aig-legend">Blue: inputs · Green: outputs · Purple: selected · Red: critical · Orange: fanout · Broken line: inverted</span>`,
  unavailableControls: ["compareButton", "focusedViewButton", "viewMenu", "layoutMenu", "timingMenu", "adjustLayoutButton",
    "libertyMenu", "cellConfigMenu", "timingInput", "pasteTimingButton", "saveGoldenButton", "goldenInput",
    "addFocusedRootButton", "setFocusedRootButton", "editCellDefinitionButton", "moduleBackButton", "moduleForwardButton",
    "diagnosticsDrawer", "toggleDiagnosticsButton"],
  searchPlaceholder: "Find AIG name or source ID…"
});
