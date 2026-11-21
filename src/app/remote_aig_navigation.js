import { checkScope, invalid, number, pageRows, reference } from "./remote_object_queries.js";
import { runViewportCommand } from "./remote_viewport_commands.js";

export function createRemoteAigNavigation(domain) {
  function resolve(key,view) {
    const outer = reference(key);
    checkScope(outer,view);
    const ref = outer?.objectRef || outer;
    checkScope(ref,view);
    const id = typeof ref === "string" ? ref : ref?.sourceId || ref?.mappedName || ref?.localId || ref?.id;
    let object = ref?.slot !== undefined && ref.nodeId ? domain.navigation.connections(ref.nodeId).incoming.find(e => String(e.slot) === String(ref.slot)) :
      ref?.sourceId || ref?.mappedName ? null : domain.navigation.object(id);
    if (!object && id) {
      const ids = domain.navigation.named(id);
      if (ids.length > 1) throw invalid("AMBIGUOUS_OBJECT","Choose a canonical AIG object ID",{candidates:ids});
      if (ids.length) object = domain.navigation.object(ids[0]);
    }
    if (!object) throw invalid("OBJECT_NOT_FOUND","Choose an object in the current AIG");
    return object;
  }
  function record(object,view) {
    return object && {id:object.id,kind:object.kind || "edge",name:object.label || object.id,
      documentId:view.documentId,graphId:view.graphId};
  }
  const dispatch = (name,...args) => domain.routeCommand(name,() => {},args);
  return async (job,view) => {
    const {name,args,opts} = job, [group,action] = name.split(" ");
    const nav = domain.navigation, fresh = nav.read;
    if (group === "selection" || name === "search open") {
      if (action === "set" || name === "search open") {
        const object = resolve(args[0],view);
        await nav.select(object.id,name === "search open");
        if (fresh().selectedId !== object.id) throw invalid("OBJECT_NOT_VISIBLE","Object is outside the active view");
      } else if (action === "clear") nav.select(null,false);
      else if (action === "zoom") {
        if (!view.selectedId) throw invalid("NO_SELECTION","Select an AIG object first");
        nav.zoom(view.selectedId);
      }
      const selection = record(nav.object(fresh().selectedId),fresh()) || null;
      return {selection,tabs:selection ? ["summary","connections","source","analysis"] : []};
    }
    if (group === "focus" || group === "view") {
      if (group === "view") {
        if (action === "focused" && !view.focusedRootNodeIds.length && !nav.object(view.selectedId)?.kind)
          throw invalid("NO_SELECTION","Select an AIG node to focus");
        await dispatch("setViewMode",action);
      } else if (action === "depth") {
        const fanin = number(opts.fanin ?? view.faninDepth,"fanin"), fanout = number(opts.fanout ?? view.fanoutDepth,"fanout");
        if (![fanin,fanout].every(n => Number.isInteger(n) && n >= 0)) throw invalid("INVALID_ARGUMENT","Depth must be unsigned");
        if (opts.fanin !== undefined || opts.fanout !== undefined) await nav.depth(fanin,fanout);
      } else if (action === "clear") await dispatch("clearFocusedRoots");
      else if (action !== "list") {
        const ids = args.map(value => {
          const item = resolve(value,view);
          if (!item.kind || item.source !== undefined && item.target !== undefined) throw invalid("INVALID_ROOT","Choose an AIG node");
          if (["activate","remove"].includes(action) && !view.focusedRootNodeIds.includes(item.id)) throw invalid("ROOT_NOT_FOUND","Unknown Focused root");
          return item.id;
        });
        await nav.roots(action,ids,action === "remove" ? undefined : ids.at(-1));
        const after = fresh().focusedRootNodeIds;
        if (ids.some(id => after.includes(id) === (action === "remove"))) throw invalid("FOCUS_REJECTED","Focused roots could not be applied");
      }
      const state = fresh(), filter = (opts.filter || "").toLocaleLowerCase();
      return {roots:state.focusedRootNodeIds.filter(id => id.toLocaleLowerCase().includes(filter)),active:state.activeFocusedRootNodeId,
        mode:state.viewMode,fanin:state.faninDepth,fanout:state.fanoutDepth};
    }
    if (group === "viewport") return runViewportCommand(job,view.viewport,view.mount,
      next => domain.viewport.commit("domain",next),() => dispatch("fitToView")) || fresh().viewport;
    if (group === "history") {
      const delta = action === "back" ? -1 : 1;
      if (!nav.canNavigate(delta)) throw invalid("HISTORY_BOUNDARY","No view in that direction");
      await dispatch("navigateViewHistory",delta);
      const current = fresh();
      return {graphId:current.graphId,roots:current.focusedRootNodeIds,viewport:current.viewport};
    }
    if (group !== "inspect") throw invalid("DOMAIN_MISMATCH","This command requires a Netlist workspace");
    const item = resolve(args[0] || view.selectedId,view);
    const info = record(item,view);
    if (action === "follow") {
      await nav.select(item.id,true);
      return {selection:record(nav.object(fresh().selectedId),fresh()) || null};
    }
    if (action === "copy") {
      const ref = reference(args[0]), field = ref?.field || "id";
      if (field === "id") return item.id;
      const index = Number(ref.index ?? 0);
      if (!Number.isSafeInteger(index) || index < 0) throw invalid("INVALID_ARGUMENT","Invalid source field index");
      const value = {name:item.primaryNameMapping?.name || item.label,source:item.sourceRefs?.[index]?.id,
        mapping:item.nameMappings?.[index]?.name}[field];
      if (value === undefined) throw invalid("FIELD_NOT_FOUND","No such AIG source field");
      return value;
    }
    if (action === "tooltip") return {object:info,text:view.mount.querySelector(`[data-domain-object="${CSS.escape(item.id)}"] title`)?.textContent || item.description || info.name};
    const edges = nav.connections(item.id);
    if (action === "connections") {
      const groups = {incoming:edges.incoming,outgoing:edges.outgoing,connections:[...edges.incoming,...edges.outgoing]};
      if (item.source !== undefined && item.target !== undefined)
        groups.connections = [nav.object(item.source),nav.object(item.target)].filter(Boolean);
      const group = opts.group || "connections";
      if (!Object.hasOwn(groups,group)) throw invalid("INVALID_ARGUMENT","Unknown AIG connection group");
      return {...pageRows(groups[group].map(edge => ({...record(edge,view),source:edge.source,target:edge.target,slot:edge.slot})),opts["page-number"]),object:info,group};
    }
    const fields = {summary:info,connections:{incoming:edges.incoming.length,outgoing:edges.outgoing.length},source:{
      id:item.id,description:item.description,source:item.source,target:item.target,slot:item.slot,sourceRefs:item.sourceRefs,nameMappings:item.nameMappings},
      analysis:nav.analysis(item.id)};
    if (opts.tab && !Object.hasOwn(fields,opts.tab)) throw invalid("INVALID_ARGUMENT","Unknown AIG inspector tab");
    return {object:info,...(opts.tab ? {[opts.tab]:fields[opts.tab]} : fields)};
  };
}
