import { readAigNavigatorPage } from "../ui/aig_panels.js";
import { demand, resultPage, resultSummary, analysisStatus, pathItems } from "./structure_command_results.js";

const categories = {reconvergence:"reconvergence",blocks:"block",block:"block"};
const blockTypes = {all:"all",xor:"xor",xor2:"xor",xnor:"xnor",xnor2:"xnor",mux:"mux",mux2:"mux"};
const overlays = {critical:"critical",fanout:"fanout","block-labels":"structureLabels","dim-outside":"structureDim"};

export function createAigInspectionCommands({read, readPanels, selectedId, policy, changePresentation,
    changeStyle, panelEvent, structure, renderPanels, syncControls, persist}) {
  return async ({name,args,opts}) => {
    const workspace = demand(read(), "DOMAIN_MISMATCH", "Open an AIG first");
    const owner = workspace.document;
    const current = () => demand(read()?.document === owner,"STALE_DOCUMENT","AIG document changed during the command");
    const currentScope = () => {
      current();
      demand(read().analysisScopeId === workspace.analysisScopeId && read().sessionId === workspace.sessionId,
        "STALE_DOCUMENT","AIG analysis scope changed during the command");
    };
    const panels = readPanels();
    const requested = Number(opts["page-number"] || 1);
    function render() { renderPanels(); persist(); }
    if (name === "ui page") {
      const key = {"analysis-details":"aigAnalysisDetailPage","analysis-results":"aigAnalysisPage"}[args[0]];
      const page = String(Number(args[1]) - 1);
      if (key) panelEvent({[key]:page});
      else panelEvent({aigPage:page,aigPageTarget:args[0]});
      return {list:args[0],page:Number(args[1])};
    }
    if (name === "aig view") {
      demand(["logic","standard"].includes(args[0]),"INVALID_ARGUMENT","Expected logic or standard");
      const desired = args[0] === "logic" ? "abc" : "standard";
      await changeStyle(desired, true);
      current();
      demand(policy().viewStyle === desired,"VIEW_UNAVAILABLE","View change did not commit");
      return {view:args[0]};
    }
    if (name === "aig objects" || name === "aig names") {
      const tab = name === "aig names" ? "names" : "objects";
      if (tab === "names") demand(workspace.presentation.document.model.nameMappings?.length, "UNAVAILABLE","This AIG has no name mappings");
      const values = tab === "names" ? {nameQuery:opts.query ?? panels.navigator.nameQuery} : {
        type:opts.type ?? panels.navigator.type, query:opts.query ?? panels.navigator.query,
        analysisFilter:opts.filter ?? panels.navigator.analysisFilter,sort:opts.sort ?? panels.navigator.sort};
      if (tab === "objects") {
        demand(["ports","all","pi","po","and","constant"].includes(values.type) &&
          ["all","critical","fanout"].includes(values.analysisFilter) && ["name","depth","fanout"].includes(values.sort),
          "INVALID_ARGUMENT","Unknown AIG object filter or sort");
      }
      const next = {...panels.navigator,...values,tab,page:requested - 1,fanoutThreshold:policy().fanoutThreshold};
      const result = readAigNavigatorPage(workspace.presentation,next);
      demand(result.page === requested,"PAGE_OUT_OF_RANGE","Navigator page is out of range");
      Object.assign(panels.navigator,values,{tab,page:requested - 1}); render();
      return result;
    }
    if (name === "aig reveal-selection") {
      const id = demand(selectedId(),"NO_SELECTION","Select an AIG object first");
      demand(workspace.query.nodeById.has(id),"UNAVAILABLE","The Objects navigator lists nodes");
      panelEvent({aigShowSelection:id}); return {id,page:panels.navigator.page + 1};
    }
    if (name === "aig overlay" || name === "aig connections" || name === "aig fanout-threshold") {
      let key, value;
      if (name === "aig overlay") {
        key = demand(Object.hasOwn(overlays,args[0]) && overlays[args[0]],"INVALID_ARGUMENT","Unknown overlay");
        demand(["on","off"].includes(args[1]),"INVALID_ARGUMENT","Choose on or off"); value = args[1] === "on";
      } else if (name === "aig connections") {
        key = "connectionHighlight"; value = args[0];
        if (!["off","all"].includes(value)) {
          value = Number(value); demand(Number.isSafeInteger(value) && value > 0,"INVALID_ARGUMENT","Expected a positive depth");
        }
      } else {
        key = "fanoutThreshold"; value = Number(args[0]);
        demand(Number.isSafeInteger(value) && value > 0 && value <= 1000000,"INVALID_ARGUMENT","Threshold is out of range");
      }
      changePresentation(key,value); syncControls(); render();
      return {option:key,value:policy()[key]};
    }
    const view = structure.view;
    const status = () => analysisStatus(view(),workspace.analysisScopeLabel,view().selectedId);
    const query = () => demand(view().query,"ANALYSIS_UNAVAILABLE","Wait for analysis results");
    const selected = id => demand(query().get(id),"OBJECT_NOT_FOUND","Unknown structure result");
    const category = value => demand(Object.hasOwn(categories,value) && categories[value],"INVALID_ARGUMENT","Expected reconvergence or blocks");
    switch (name) {
      case "analysis status": return status();
      case "analysis run": {
        const completed = await structure.run(); currentScope();
        demand(completed,"CANCELLED","Analysis superseded");
        return {...status(),partial:view().status === "partial"};
      }
      case "analysis cancel": structure.cancel(); return status();
      case "analysis retry": {
        demand(args[0] === "detail","UNAVAILABLE","AIG supports retrying a selected reconvergence detail");
        demand(selected(view().selectedId).category === "reconvergence","UNAVAILABLE","Only reconvergence has a detail job");
        const completed = await structure.selectResult(view().selectedId); currentScope();
        demand(completed,"CANCELLED","Structure detail superseded");
        return status();
      }
      case "analysis results": {
        const group = category(args[0]);
        const key = String(opts.type || "all").toLowerCase();
        const type = demand(Object.hasOwn(blockTypes,key) && blockTypes[key],"INVALID_ARGUMENT","Unknown block type");
        demand(group === "block" || type === "all","INVALID_ARGUMENT","Type filtering requires block results");
        const page = resultPage(query().list(group,type),requested);
        Object.assign(panels.analysis,{category:group,type,page:page.page - 1});
        panels.navigator.tab = "analysis"; render();
        return {...page,entries:page.entries.map(resultSummary)};
      }
      case "analysis select":
      case "analysis detail": {
        const item = selected(args[0]);
        const section = opts.section || "summary";
        const sections = item.category === "block" ? ["summary","pins","uses","taps","root-uses"] : ["summary","path-a","path-b","union"];
        demand(sections.includes(section),"INVALID_ARGUMENT","Unknown detail section for this result");
        if (section === "summary") demand(requested === 1,"PAGE_OUT_OF_RANGE","Summary has one page");
        panels.navigator.tab = "analysis";
        const completed = await structure.selectResult(item.id); currentScope();
        demand(view().selectedId === item.id,"CANCELLED","Structure selection changed");
        if (item.category === "reconvergence")
          demand(completed,"CANCELLED","Structure detail superseded");
        if (name === "analysis select") return resultSummary(item);
        const root = item.category === "block" ? query().functionAtUse(item) : null;
        if (section === "summary") return {...resultSummary(item),pins:root?.pins,rootType:root?.kind,detailStatus:view().detailStatus};
        let values;
        if (section === "path-a" || section === "path-b") values = pathItems(item.paths?.[section === "path-a" ? 0 : 1]);
        else if (section === "union") values = view().detail?.nodeIds || [];
        else if (section === "pins" && root) values = Object.entries(root.pins).map(([role,pin])=>({role,...pin}));
        else if (item.category === "block" && ["uses","taps","root-uses"].includes(section)) {
          const presented = workspace.presentation;
          const uses = query().blockUses(item,(presented.displayAnalysis || presented.document.analysis).outgoing,presented.visibleEdgeIds);
          values = section === "taps" ? uses.taps : section === "root-uses" ? uses.rootEdges : [...uses.rootEdges,...uses.taps];
        } else throw Object.assign(new Error("Unknown detail section for this result"), {code:"INVALID_ARGUMENT"});
        const page = resultPage(values,requested);
        panels.analysis.detailPage = page.page - 1; render();
        return {id:item.id,section,...page};
      }
      case "analysis related": {
        const subject = demand(query().get(args[0]) || workspace.query.getObject(args[0]),"OBJECT_NOT_FOUND","Unknown AIG object or result");
        const group = category(opts.kind || (subject.category === "reconvergence" ? "blocks" : "reconvergence"));
        const detail = view().selectedId === subject.id ? view().detail : null;
        const page = resultPage(query().relatedTo(subject,group,detail),requested);
        return {...page,entries:page.entries.map(resultSummary)};
      }
      case "analysis locate": demand(structure.locate(),"OUTSIDE_VIEW","No visible structure selection"); return status();
      case "analysis clear": structure.action({aigAnalysisAction:"clear"}); return status();
    }
  };
}
