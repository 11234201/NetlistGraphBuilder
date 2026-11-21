import { getCompareNodeName } from "../domains/netlist/compare_objects.js";
import { createLayoutCommands } from "./remote_layout_commands.js";
import { runViewportCommand } from "./remote_viewport_commands.js";
import { createRemoteAigNavigation } from "./remote_aig_navigation.js";
import { checkScope, hierarchyRows, invalid, number, objectRecord, reference, resolveNetlistObject } from "./remote_object_queries.js";
import { readRemoteInspection } from "./remote_netlist_inspection.js";

const scoped = new Set(["hierarchy enter","search open","selection set","selection get","selection clear","selection zoom",
  "inspect show","inspect connections","inspect follow","inspect tooltip","inspect copy","focus list","focus add","focus replace",
  "focus activate","focus remove","focus clear","viewport get","viewport pan","viewport zoom","adjust move","adjust size","adjust reset-size",
  "adjust property","adjust reset-properties","adjust pin","adjust reset-pins","net route"]);
const groups = new Set(["hierarchy","search","selection","inspect","view","focus","viewport","history",
  "display","layout","adjust","net"]);
export function createNavigationCommands(services) {
  const {read, actions:a, hierarchy, domainWorkbench, renderCompletion, elements} = services;
  const run = operation => renderCompletion.run(operation);
  const layout = createLayoutCommands(services);
  const aigCommands = createRemoteAigNavigation(domainWorkbench);
  let searches = [];
  function select(view,item,record = true) {
    if (view.side) return a.selectCompareObject(item.node ? (item.node.kind === "cell" ? "cell" : "port") : "net",
      item.node ? getCompareNodeName(item.node) : item.name,false,view.side,record);
    if (!item.node) return a.setSelectedNet(item.name,record);
    return a.setSelectedNode(item.id,record);
  }
  const currentSelection = view => view.selected ? objectRecord(view,resolveNetlistObject(view,view.selected)) : null;
  function roots(view,filter = "") {
    const matches = String(filter).toLocaleLowerCase();
    return {roots:view.roots.filter(id => id.toLocaleLowerCase().includes(matches)),active:view.activeRoot,
      mode:view.mode,fanin:view.fanin,fanout:view.fanout};
  }
  return async function execute(job) {
    const {name,args,opts} = job, [group,action] = name.split(" ");
    if (!groups.has(group) && name !== "golden save" || name === "net route" && !services.netRouting) return;
    const activeAig = domainWorkbench.navigation.read();
    const side = ({A:"left",B:"right"})[opts.side];
    const view = activeAig || read(side);
    if (opts.side && !view.compare) throw invalid("INVALID_SIDE","Only a Compare page accepts a side");
    if (view.compare && scoped.has(name) && !side && !view.selectedSide)
      throw invalid("SIDE_REQUIRED","Choose side A or B",{candidates:["A","B"]});
    if (name === "search find") {
      searches = services.search(args[0]).map(hit => ({...hit,documentId:view.documentId,sourceRevision:view.sourceRevision,
        ...(activeAig && {graphId:view.graphId})}));
      return searches;
    }
    if (name === "search clear") { searches = []; services.clearSearch(); return {count:0}; }
    if (name === "search open") {
      const key = reference(args[0]);
      const hit = typeof key === "string" ? searches.find(item => item.id === key) : key;
      if (!hit?.id) throw invalid("OBJECT_NOT_FOUND","Pass a result from search find");
      checkScope(hit,view);
      if (hit.outsidePath) throw invalid("OUTSIDE_PATH","Search result is outside Show Path");
      if (activeAig) return aigCommands({...job,args:[hit.id]},activeAig);
      if (!hit.target || !hit.moduleName) throw invalid("INVALID_ARGUMENT","Incomplete search result");
      if (view.compare && hit.moduleName !== view.moduleName) throw invalid("STALE_REFERENCE","Search result belongs to another Compare module");
      if (view.compare && hit.target.kind !== "module") {
        const item = resolveNetlistObject(view,{kind:hit.target.kind,name:hit.target.name});
        select(view,item);
        a.focusSelectedCell();
      } else await run(() => a.activateSearchResult(hit));
      return {id:hit.id,moduleName:read(side).moduleName,selection:currentSelection(read(side))};
    }
    if (activeAig) return aigCommands(job,activeAig);
    if (group === "hierarchy") {
      if (view.compare && action !== "enter") throw invalid("DOMAIN_MISMATCH","Open hierarchy in Single view");
      const tree = hierarchy(), rows = hierarchyRows(tree);
      if (action === "list") {
        const filter = (opts.filter || "").toLocaleLowerCase();
        return {items:rows.filter(row => [row.moduleName,row.label,row.instanceName].some(x => x?.toLocaleLowerCase().includes(filter))),
          truncated:tree.truncated};
      }
      if (action === "occurrences") return rows.filter(row => row.moduleName === args[0]);
      let target;
      if (action === "open") target = rows.find(row => row.id === args[0]);
      else if (action === "enter") {
        const {node} = resolveNetlistObject(view,args[0]);
        if (!node?.referencedModuleName) throw invalid("NOT_SUBMODULE","The selected object is not a module instance");
        const instance = getCompareNodeName(node);
        const parents = rows.filter(row => row.moduleName === view.moduleName &&
          (!view.occurrence || row.rootModuleName === view.occurrence.rootModuleName &&
          JSON.stringify(row.occurrencePath) === JSON.stringify(view.occurrence.occurrencePath)));
        if (parents.length !== 1) throw invalid("OCCURRENCE_REQUIRED","Choose a parent occurrence",{candidates:parents.map(x => x.id)});
        target = rows.find(row => row.parent === parents[0].id && row.instanceName === instance);
      } else return;
      if (!target) throw invalid("OCCURRENCE_NOT_FOUND","Hierarchy occurrence is unavailable");
      await run(() => {
        if (view.compare) a.exitCompareView({deferSingleRender:true});
        a.selectModule(target.moduleName,{rootModuleName:target.rootModuleName,occurrencePath:target.occurrencePath});
      });
      return target;
    }
    if (group === "selection") {
      if (action === "set") select(view,resolveNetlistObject(view,args[0]));
      else if (action === "clear") view.side ? a.clearCompareSelection() : a.setSelectedNode(null);
      else if (action === "zoom") {
        if (!view.selected) throw invalid("NO_SELECTION","Select an object first");
        if (view.side) select(view,resolveNetlistObject(view,view.selected),false);
        await run(() => a.focusSelectedCell());
      } else if (action !== "get") return;
      const selection = currentSelection(read(side));
      return {selection,tabs:selection ? ["summary","properties","attributes","connections","timing","source","analysis"] : []};
    }
    if (group === "inspect") {
      if (action === "follow") {
        const candidate = reference(args[0]), target = candidate?.target || candidate;
        checkScope(target,view);
        if (target?.origin) resolveNetlistObject(view,target.origin);
        if (!target || !["node","net"].includes(target.kind)) throw invalid("INVALID_ARGUMENT","Pass a connection target");
        if (view.side && target.moduleName && target.moduleName !== view.moduleName) throw invalid("STALE_REFERENCE","Target belongs to another module");
        if (target.moduleName) {
          const exists = hierarchyRows(hierarchy()).some(r => r.moduleName === target.moduleName && r.rootModuleName === target.rootModuleName &&
            JSON.stringify(r.occurrencePath) === JSON.stringify(target.occurrencePath));
          if (!exists) throw invalid("OCCURRENCE_NOT_FOUND","Connection occurrence no longer exists");
        } else resolveNetlistObject(view,target);
        if (view.side && !a.selectionTargetExists(view.graph,target)) throw invalid("OBJECT_NOT_VISIBLE","Connection is outside the current Compare view");
        if (view.side) select(view,resolveNetlistObject(view,target));
        await run(() => view.side ? a.navigateCompareSelectionTarget(target) : a.navigateSingleSelectionTarget(target));
        const selection = currentSelection(read(side));
        if (!selection || selection.id !== (target.kind === "net" ? "net:" + target.name : target.id))
          throw invalid("OBJECT_NOT_VISIBLE","Connection could not be selected in the current view");
        return {selection};
      }
      return readRemoteInspection(job,view,a.currentHierarchyInspectionContext);
    }
    if (group === "focus") {
      if (action === "list") return roots(view,opts.filter);
      if (action === "depth") {
        const depths = [opts.fanin ?? view.fanin,opts.fanout ?? view.fanout].map(x => number(x,"depth"));
        if (depths.some(x => !Number.isInteger(x) || x < 0)) throw invalid("INVALID_ARGUMENT","Depth must be an unsigned integer");
        if (opts.fanin !== undefined || opts.fanout !== undefined) {
          elements.faninDepthInput.value = String(depths[0]); elements.fanoutDepthInput.value = String(depths[1]);
          await run(() => a.handleFocusedDepthChange());
        }
      } else if (action === "clear") await run(() => a.clearFocusedRoots(view.side));
      else {
        const ids = args.map(value => {
          const hit = searches.find(result => result.id === value);
          const item = resolveNetlistObject(view,hit || value);
          if (item.node && item.node.kind !== "cell") throw invalid("INVALID_ROOT","Choose a cell or a net");
          if (["remove","activate"].includes(action) && !view.roots.includes(item.id)) throw invalid("ROOT_NOT_FOUND","Unknown Focused root");
          return item.id;
        });
        await run(() => a.runViewHistoryTransaction({label:name},() => a.changeFocusedRoots(action,ids,view.side)));
      }
      return roots(read(side));
    }
    if (group === "history") {
      const delta = action === "back" ? -1 : 1, next = view.historyIndex + delta;
      if (next < 0 || next >= view.historyCount) throw invalid("HISTORY_BOUNDARY","No view in that direction");
      await run(() => a.navigateViewHistory(delta));
      return {index:read().historyIndex,moduleName:read().moduleName};
    }
    if (group === "viewport") {
      const apply = next => a.runViewHistoryTransaction({label:name},() => {
        if (view.side) { a.setCompareTransform(view.side,next); a.applyCompareTransforms(); }
        else { a.setSingleTransform(next); a.applyTransform(); }
        a.commitViewHistory();
      });
      return runViewportCommand(job,view.transform,view.mount,apply,a.fitToView) || {...read(side).transform};
    }
    if (group === "view") {
      if (action === "focused" && !view.selected && !view.roots.length) throw invalid("NO_SELECTION","Select a Focused root");
      await run(() => a.setViewMode(action));
      return roots(read(side));
    }
    return layout(job,view);
  };
}
