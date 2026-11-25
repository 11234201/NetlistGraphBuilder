import { openInspectionPage } from "../ui/objectDetailsPanel.js";
import { demand } from "./structure_command_results.js";

const menuIds = {file:"fileMenu",settings:"settingsMenu",view:"viewMenu",layout:"layoutMenu",timing:"timingMenu",
  liberty:"libertyMenu","cell-config":"cellConfigMenu","aig-overlays":"aigOverlaySettings",
  "compare-a":"compareLeftFilesMenu","compare-b":"compareRightFilesMenu",sync:"compareOptionsMenu",roots:"focusedRootsMenu"};
const focusIds = {search:"searchInput","path-find":"pathFind",hierarchy:"moduleHierarchyFilter",roots:"focusedRootsFilter",editor:"netlistTextInput"};
const businessControls = {
  fileInput:"files import",addDesignInput:"design add",aigFileInput:"aig open",addAigInput:"aig add",serverFiles:"files browse",
  aigSearchFirstInput:"aig import-mode",cancelDomainImportButton:"aig cancel-import",pasteNetlistButton:"text open",
  pasteAigButton:"text open",addAigText:"text open",timingInput:"timing open",addTimingInput:"timing add",pasteTimingButton:"text open",
  levelInput:"level open",pasteLevelButton:"text open",goldenInput:"golden load",saveGoldenButton:"golden save",exportSvgButton:"svg export",showAliasesInput:"display aliases",
  fanoutHubsInput:"display hubs",gateSymbolModeSelect:"display symbols",layoutProviderSelect:"layout provider",
  wireSpacingInput:"layout spacing",cellSpacingInput:"layout spacing",resetLayoutButton:"layout reset-overrides",
  timingMetricSelect:"timing metric",timingSlackThresholdInput:"timing threshold",libertyInput:"liberty load",
  clearLibertyButton:"liberty unload",cancelLibertyButton:"liberty cancel",cellConfigInput:"cell-config import",
  exportCellConfigButton:"cell-config export",resetCellConfigButton:"cell-config reset",editCellDefinitionButton:"cell-config edit",
  aigGraphSelect:"module open",searchInput:"search find",searchClearButton:"search clear",moduleHierarchyFilter:"hierarchy list",
  moduleBackButton:"history back",moduleForwardButton:"history forward",wholeViewButton:"view whole",focusedViewButton:"view focused",
  showPathButton:"path open",fitButton:"viewport fit",adjustLayoutButton:"adjust mode",compareButton:"compare enter",
  leftModuleSelect:"compare module",rightModuleSelect:"compare module",applyCompareButton:"compare apply",exitCompareButton:"compare exit",
  compareLayoutSelect:"compare split",syncCompareInput:"compare sync-viewport",syncCompareFocusInput:"compare sync-roots",
  syncCompareSelectionInput:"compare sync-selection",
  compareOutputSelect:"compare cone",coneDepthInput:"compare cone-depth",compareLeftNetlistInput:"compare design",compareRightNetlistInput:"compare design",
  compareLeftTimingInput:"timing open",compareRightTimingInput:"timing open",compareLeftClearTimingButton:"compare clear-timing",
  compareRightClearTimingButton:"compare clear-timing",addFocusedRootButton:"focus add",setFocusedRootButton:"focus replace",
  removeFocusedRootButton:"focus remove",clearFocusedRootsButton:"focus clear",focusSelectedButton:"selection zoom",
  faninDepthInput:"focus depth",fanoutDepthInput:"focus depth",pathFind:"path find",pathSide:"path open",netlistTextInput:"text set",
  processLogLevelFilter:"log filter",processLogPhaseFilter:"log filter",processLogAutoScroll:"log autoscroll",
  copyProcessLogButton:"log copy",exportProcessLogButton:"log export",clearProcessLogButton:"log clear",helpButton:"ui help"
};
const isOpen = value => {
  demand(["open","close"].includes(value),"INVALID_ARGUMENT","Choose open or close");
  return value === "open";
};
const visible = element => element && !element.closest("[hidden],[inert]");
const field = (object,key) => Object.hasOwn(object,key) ? object[key] : undefined;

export function createPanelCommands({document:doc, windowTarget, context, readShell, domainWorkbench, quickInput, processLogController:log,
    runPathCommand, runNetlistAnalysisCommand}) {
  const get = id => doc.getElementById(id);
  function tabs(panel) {
    demand(["navigator","inspector"].includes(panel),"INVALID_ARGUMENT","Unknown tab panel");
    const key = context().mode === "AIG" ? (panel === "navigator" ? "aigNavTab" : "aigInspectorTab")
      : panel === "navigator" ? "navTab" : "inspectorTab";
    const attribute = key.replace(/[A-Z]/g,letter => "-" + letter.toLowerCase());
    return [...get(panel + "Panel").querySelectorAll("[data-" + attribute + "]")].filter(visible)
      .map(element => ({id:element.dataset[key],element}));
  }
  function disclosures() {
    const result = new Map();
    for (const button of get("searchResults").querySelectorAll("[data-search-actions]"))
      if (visible(button)) result.set("search-add:" + (Number(button.dataset.searchActions) + 1), button);
    for (const [key,id] of Object.entries(menuIds)) {
      const element = get(id);
      if (visible(element) && element.tagName === "DETAILS") result.set(key,element);
    }
    for (const element of doc.querySelectorAll("details")) {
      if (!visible(element)) continue;
      const logEntry = element.closest("[data-log-sequence]");
      if (logEntry) result.set("log:" + logEntry.dataset.logSequence,element);
      else if (element.id) result.set(element.id,element);
      else if (element.matches(".inspector-canonical-name")) result.set("canonical-name",element);
      else if (element.closest("#searchResults")) {
        const index = [...get("searchResults").querySelectorAll("details")].indexOf(element);
        result.set("search-add:" + (index + 1),element);
      } else {
        const label = element.querySelector(":scope > summary")?.textContent.trim();
        if (label) result.set(label,element);
      }
    }
    return result;
  }
  function lists() {
    const result = new Map();
    for (const el of doc.querySelectorAll("[data-page-count]")) {
      if (!visible(el)) continue;
      if (el.dataset.reconPage) {
        result.set("analysis-" + el.dataset.reconPage,{el,pages:Number(el.dataset.pageCount),page:Number(el.dataset.currentPage)});
        continue;
      }
      const button = el.querySelector("[data-aig-page-target],[data-inspection-page-group]");
      if (!button) continue;
      const ref = button.dataset.aigPageTarget || button.dataset.inspectionPageGroup;
      result.set(ref,{el,button,pages:Number(el.dataset.pageCount),page:Number(el.dataset.currentPage)});
    }
    return result;
  }
  function controls() {
    const result = [];
    for (const [ref,command] of Object.entries(businessControls)) {
      const el = get(ref);
      if (!visible(el)) continue;
      const values = el.type === "checkbox" ? ["on","off"] : el.options ? [...el.options].slice(0,100).map(opt => opt.value) : undefined;
      result.push({ref,command,values,disabledReason:el.disabled ? (el.title || "disabled") : null});
    }
    for (const panel of ["navigator","inspector","log","diagnostics"]) {
      const el = get(({navigator:"toggleNavigatorButton",inspector:"toggleInspectorButton",log:"toggleProcessLogButton",
        diagnostics:"toggleDiagnosticsButton"})[panel]);
      if (visible(el)) result.push({ref:panel,command:"ui panel",values:["open","close"],disabledReason:el.disabled ? "disabled" : null});
    }
    for (const [ref,el] of disclosures()) result.push({ref,command:field(menuIds,ref) || ref.startsWith("search-add:") ? "ui menu" : "ui disclosure",
      open:el.tagName === "DETAILS" ? el.open : el.getAttribute("aria-expanded") === "true",values:["open","close"]});
    for (const [ref,id] of Object.entries(focusIds)) if (visible(get(id))) result.push({ref,command:"ui focus",disabledReason:get(id).disabled ? "disabled" : null});
    for (const panel of ["navigator","inspector"]) {
      const values = tabs(panel).map(tab => tab.id);
      if (values.length) result.push({ref:panel,command:"ui tab",values});
    }
    for (const [ref,{page,pages}] of lists()) result.push({ref,command:"ui page",page,pages});
    return result;
  }
  return function panelCommand(job) {
    const {name,args} = job;
    const [target,value] = args;
    switch (name) {
      case "ui status": return {...context(),status:get("statusBar").textContent,provider:get("providerStatus").textContent,
        selection:get("selectionSummaryButton").textContent};
      case "ui controls": return controls();
      case "ui panel": {
        const open = isOpen(value);
        if (["navigator","inspector"].includes(target)) readShell().setPanelOpen(target,open);
        else if (target === "log") log.toggle(open);
        else if (target === "diagnostics") {
          const toggle = get("toggleDiagnosticsButton");
          demand(visible(toggle),"UNAVAILABLE","Diagnostics is unavailable");
          if (get("diagnosticsDrawer").hidden === open) toggle.click();
        } else throw Object.assign(new Error("Unknown panel"), {code:"INVALID_ARGUMENT"});
        return {panel:target,open};
      }
      case "ui resize":
        demand(["navigator","inspector"].includes(target),"INVALID_ARGUMENT","Unknown panel");
        return {panel:target,width:readShell().setPanelWidth(target,Number(value))};
      case "ui tab": {
        demand(["navigator","inspector"].includes(target),"INVALID_ARGUMENT","Unknown tab panel");
        readShell().setPanelOpen(target,true);
        const choices = tabs(target);
        const tab = demand(choices.find(item => item.id === value),"UNAVAILABLE","Unknown tab for this workspace");
        tab.element.click();
        return {panel:target,tab:value,choices:choices.map(item => item.id)};
      }
      case "ui menu":
      case "ui disclosure": {
        const open = isOpen(value);
        const item = demand(disclosures().get(target),"UNAVAILABLE","Unknown or unavailable disclosure");
        if (item.tagName === "BUTTON") {
          if ((item.getAttribute("aria-expanded") === "true") !== open) item.click();
          return {ref:target,open:item.getAttribute("aria-expanded") === "true"};
        }
        if (open) {
          for (let ancestor = item.parentElement?.closest("details"); ancestor; ancestor = ancestor.parentElement?.closest("details")) ancestor.open = true;
        }
        item.open = open;
        return {ref:target,open:item.open};
      }
      case "ui focus": {
        const el = get(field(focusIds,target) || target);
        demand(visible(el) && el.matches("button, input:not([type=file]),textarea,select,summary,[tabindex]") && !el.disabled,
          "UNAVAILABLE","Control is unavailable");
        el.focus(); demand(doc.activeElement === el,"UNAVAILABLE","Control cannot receive focus");
        return {ref:target};
      }
      case "ui page": {
        if (["path-report","path-search"].includes(target)) return runPathCommand(job);
        const pager = demand(lists().get(target),"UNAVAILABLE","List is unavailable or has only one page");
        const page = Number(value);
        demand(Number.isSafeInteger(page) && page >= 1 && page <= pager.pages,"PAGE_OUT_OF_RANGE","Choose an existing list page");
        if (pager.el.dataset.reconPage) return runNetlistAnalysisCommand(job);
        if (pager.button.dataset.aigPageTarget) return domainWorkbench.runInspectionCommand(job);
        const list = [...doc.querySelectorAll("[data-inspection-list]")].find(el => visible(el) && el.dataset.inspectionList === target);
        openInspectionPage(list,page);
        return {list:target,page};
      }
      case "ui help": {
        const open = isOpen(target);
        if (get("helpDialog").open !== open) get(open ? "helpButton" : "closeHelpButton").click();
        return {open:get("helpDialog").open};
      }
      case "ui dismiss": {
        const dialog = doc.querySelector("dialog[open]");
        if (dialog === get("netlistTextDialog")) quickInput.closeDialog();
        else if (dialog) {
          const event = new windowTarget.Event("cancel",{cancelable:true});
          if (dialog.dispatchEvent(event)) dialog.close();
        } else doc.dispatchEvent(new windowTarget.KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));
        return {dialog:doc.querySelector("dialog[open]")?.id || null};
      }
      case "diagnostics list": return [...get("diagnosticsList").children].map(row => row.textContent.trim())
        .filter(message => message && !/^no diagnostics/i.test(message));
    }
  };
}
