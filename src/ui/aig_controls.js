const presetDepths = [1, 2, 3, 4, 5];
const levelLabel = (depth) => depth === 1 ? "1 level" : `${depth} levels`;

export const aigControls = Object.freeze({
  domainId: "aig",
  toolbar: `<span class="context-note">Graphviz · AIG</span>
    <label>View <select data-domain-policy="viewStyle" aria-label="AIG view style"><option value="abc">Logic View</option><option value="standard">Standard</option></select></label>
    <span class="aig-connection-control" title="Inputs trace downstream, outputs trace upstream, and AND gates trace both ways. Each connection counts as one level in its direction.">
      <label for="aigConnectionHighlight">Highlight connections</label>
      <select id="aigConnectionHighlight">
        <option value="off">Off</option><option value="all" selected>All</option>
        ${presetDepths.map((depth) => `<option value="${depth}">${levelLabel(depth)}</option>`).join("")}
        <option data-current-depth hidden></option><option value="custom">Custom…</option>
      </select>
      <input hidden type="number" min="1" step="1" aria-label="Custom highlight levels" placeholder="Levels">
    </span>`,
  overlays: `<h2>AIG overlays</h2>
    <label title="Show the block type at each positive root, before outgoing edge inversion."><input type="checkbox" data-domain-policy="structureLabels" checked>Block labels</label>
    <label title="Select a block or reconvergence result in Analysis to fade nodes and edges outside it."><input type="checkbox" data-domain-policy="structureDim" checked>Dim outside selected result</label>
    <label><input type="checkbox" data-domain-policy="critical">Logical critical path</label>
    <span class="aig-fanout-control"><label><input type="checkbox" data-domain-policy="fanout">High fanout</label>
      <label>≥ <input type="number" data-domain-policy="fanoutThreshold" min="1" max="1000000" value="2" aria-label="High fanout threshold"></label></span>
    <span class="context-note aig-legend">Blue: inputs · Green: outputs · Purple: selected · Red: critical · Orange: fanout · Broken line: inverted</span>`,
  unavailableControls: ["compareButton", "viewMenu", "layoutMenu", "timingMenu", "adjustLayoutButton",
    "libertyMenu", "cellConfigMenu", "timingInput", "pasteTimingButton", "saveGoldenButton", "goldenInput",
    "editCellDefinitionButton",
    "diagnosticsDrawer", "toggleDiagnosticsButton"],
  searchPlaceholder: "Find AIG name or source ID…"
});

// Custom entry replaces the selector in place. All choices write the same setting.
export function bindAigConnectionHighlight(toolbar, { read, commit, preview }) {
  const group = toolbar.querySelector(".aig-connection-control");
  const select = group.querySelector("select");
  const input = group.querySelector("input");
  const current = select.querySelector("[data-current-depth]");
  function previewDepth() {
    const value = input.valueAsNumber;
    return !input.hidden && input.validity.valid && Number.isSafeInteger(value) ? value : null;
  }
  function closeEditor() {
    input.hidden = true;
    select.hidden = false;
  }

  function sync(value, disabled) {
    current.hidden = typeof value !== "number" || presetDepths.includes(value);
    if (!current.hidden) {
      current.value = String(value);
      current.textContent = levelLabel(value);
    }
    select.value = String(value);
    select.disabled = disabled;
    if (disabled && !input.hidden) { closeEditor(); preview(); }
  }
  function finish(accept, focusSelect) {
    if (input.hidden) return;
    const value = previewDepth();
    closeEditor();
    if (accept && value !== null && value !== read()) commit(value);
    else { sync(read(), select.disabled); preview(); }
    if (focusSelect) select.focus();
  }
  select.addEventListener("change", () => {
    if (select.value !== "custom") { commit(select.value); return; }
    const currentValue = read();
    input.value = typeof currentValue === "number" ? currentValue : "";
    select.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  });
  input.addEventListener("input", preview);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    finish(event.key === "Enter", true);
  });
  input.addEventListener("blur", () => finish(true, false));
  return { sync, previewDepth, closeEditor };
}
