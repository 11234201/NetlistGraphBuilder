import { createPanelCommands } from "./remote_panel_commands.js";
import { demand } from "./structure_command_results.js";

function createLogCommands({document,processLogController:log}) {
  const get = id => document.getElementById(id);
  const controls = () => ({level:get("processLogLevelFilter"),phase:get("processLogPhaseFilter")});
  function filters(opts,write = false) {
    const entries = Object.entries(controls());
    const values = {};
    for (const [key,control] of entries) {
      const value = opts[key] === "all" ? "" : opts[key] ?? control.value;
      demand([...control.options].some(option => option.value === value),"INVALID_ARGUMENT","Unknown log " + key);
      values[key] = value;
    }
    if (write) {
      for (const [key,control] of entries) control.value = values[key];
      log.render();
    }
    return Object.fromEntries(Object.entries(values).map(([key,value]) => [key,value || "all"]));
  }
  return ({name,args,opts}) => {
    switch (name) {
      case "log list": return log.model.entries(filters(opts));
      case "log filter": return filters(opts,true);
      case "log detail": {
        const id = Number(args[0]);
        const entry = demand(log.model.entries().find(row => row.sequence === id),"LOG_NOT_FOUND","Unknown log sequence");
        if (!log.model.entries(filters({})).some(row => row.sequence === id)) {
          const selected = controls();
          if (selected.level.value && selected.level.value !== entry.level) selected.level.value = "";
          if (selected.phase.value && selected.phase.value !== entry.phase) selected.phase.value = "";
        }
        log.toggle(true);
        const row = [...get("processLogList").querySelectorAll("[data-log-sequence]")].find(item => Number(item.dataset.logSequence) === id);
        const details = row?.querySelector("details");
        if (details) details.open = true;
        return entry;
      }
      case "log autoscroll": {
        demand(["on","off"].includes(args[0]),"INVALID_ARGUMENT","Choose on or off");
        get("processLogAutoScroll").checked = args[0] === "on"; log.render();
        return {enabled:get("processLogAutoScroll").checked};
      }
      case "log copy":
      case "log export": return {text:log.model.toJsonLines(filters(opts)),name:"netlist-process-log.jsonl",mime:"application/x-ndjson"};
      case "log clear": log.clear(); return {count:log.model.size};
    }
  };
}

const aigActions = new Set(["aig view","aig objects","aig reveal-selection","aig names","aig connections","aig overlay","aig fanout-threshold"]);

export function createAnalysisCommands(services) {
  const {context, domainWorkbench, runPathCommand, runNetlistAnalysisCommand, exportCurrentSvg, quickInput} = services;
  const panel = createPanelCommands(services);
  const log = createLogCommands(services);
  return async job => {
    if (job.name.startsWith("path ")) {
      const result = await runPathCommand(job);
      if (job.name === "path export") {
        const svg = demand(exportCurrentSvg(result.side,true),"SVG_UNAVAILABLE","No SVG for the selected side");
        return {...svg,mime:"image/svg+xml"};
      }
      return result;
    }
    if (job.name.startsWith("analysis ")) {
      if (["analysis results","analysis select","analysis detail","analysis related"].includes(job.name)) {
        const shell = services.readShell();
        shell.setPanelOpen("navigator",true);
        if (context().mode !== "AIG") shell.selectNavigatorTab("analysis");
        if (job.name !== "analysis results") shell.setPanelOpen("inspector",true);
      }
      return context().mode === "AIG" ? domainWorkbench.runInspectionCommand(job) : runNetlistAnalysisCommand(job);
    }
    if (aigActions.has(job.name)) return domainWorkbench.runInspectionCommand(job);
    if (job.name.startsWith("ui ") || job.name === "diagnostics list") return panel(job);
    if (job.name.startsWith("text ")) {
      if (job.name === "text open") {
        if (job.opts.side) demand(context().mode === "Compare" && job.args[0] !== "aig","INVALID_SIDE","Only Compare netlist and timing editors have sides");
        if (job.args[0] === "timing") demand(context().mode !== "AIG","DOMAIN_MISMATCH","Timing requires a netlist");
      }
      return quickInput.draftCommand(job);
    }
    if (job.name.startsWith("log ")) return log(job);
  };
}
