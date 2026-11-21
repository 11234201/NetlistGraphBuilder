import { normalizeShowPath, SHOW_PATH_POLICY, levelText } from "../contracts/show_path.js";
import { escapeHtml } from "./html.js";

export function bindShowPath(panel, { read, log, subscribe, copyText, exportSvg, navigateResult }) {
  const doc = panel.ownerDocument, get = (id) => doc.getElementById(id);
  const sidePicker = get("pathSide"), search = get("pathFind"), message = get("pathMessage");
  const showPathButton = get("showPathButton"), pathToolbar = get("pathToolbar"), pathToolbarSummary = get("pathToolbarSummary");
  let current, scope, saved, draft, explicitSide, pending, matches = [], rows = [], sourceLevels;
  let page = 0, searchPage = 0, section = "starts", frame = null, lastGraph, selection;
  const sideDrafts = new Map();
  let activeSide, lastPath, navigation = 0;
  const pageSize = SHOW_PATH_POLICY.pageSize;
  function context() { return read(explicitSide); }
  function openPanel(focusSearch = false) {
    const EventCtor = doc.defaultView?.CustomEvent || globalThis.CustomEvent;
    if (EventCtor) doc.dispatchEvent(new EventCtor("workbench-open-path", { detail: { focusSearch } }));
    if (panel.hidden) panel.hidden = false;
    sync(true);
    if (focusSearch) doc.defaultView?.requestAnimationFrame?.(() => search?.focus?.());
  }
  function reportFailure(error, operation, owner = current) {
    const details = { ...owner?.diagnostic, ...error?.pathContext, operation, code: error?.code || operation + ".failed", error,
      retainedPreviousView: true, startCount: draft?.starts.length, endCount: draft?.ends.length };
    const text = error?.message || String(error);
    try { log(error?.code === "show-path.budget" ? "warning" : "error", "graph", text, details); } catch {}
    if (owner?.scope === context()?.scope) message.textContent = text;
  }
  function formatToolbarSummary(state) {
    const side = state?.side ? (state.side === "left" ? "A · " : "B · ") : "";
    const q = state?.query;
    const counts = q ? `${q.starts.length} start(s) → ${q.ends.length} end(s)` : "";
    return counts ? `Show Path · ${side}${counts}` : "Show Path";
  }
  function sync(force = false) {
    current = context();
    const changed = scope !== current?.scope, changedQuery = saved !== JSON.stringify(current?.query || null);
    const graphChanged = lastGraph !== current?.graph;
    const selected = (explicitSide ? read() : current)?.selectedKey;
    get("pathSelection").hidden = !selected;
    selection = selected;
    const enabled = Boolean(current?.query?.enabled);
    panel.toggleAttribute("data-enabled", enabled);
    if (showPathButton) {
      showPathButton.toggleAttribute("data-enabled", enabled);
      showPathButton.setAttribute("aria-pressed", String(enabled));
    }
    if (pathToolbar) {
      pathToolbar.hidden = !enabled;
      if (pathToolbarSummary) pathToolbarSummary.textContent = formatToolbarSummary(current);
      const toolbarToggle = pathToolbar.querySelector?.('[data-path-action="toggle"]');
      if (toolbarToggle) toolbarToggle.textContent = enabled ? "Turn off" : "Turn on";
    }
    sidePicker.hidden = !current?.side;
    if (current?.side) sidePicker.value = current.side;
    else explicitSide = undefined;
    if (changed || changedQuery) {
      if (changed && activeSide) sideDrafts.set(activeSide, { scope, saved, draft });
      scope = current?.scope; saved = JSON.stringify(current?.query || null);
      activeSide = current?.side;
      if (!activeSide) sideDrafts.clear();
      const cached = changed && sideDrafts.get(activeSide);
      const editedDuringApply = !changed && pending && saved === pending.queryKey && (pending.draft !== draft || pending.keepDraft);
      if (!editedDuringApply) draft = cached?.scope === scope && cached?.saved === saved ? cached.draft
        : { starts: [...(current?.query?.starts || [])], ends: [...(current?.query?.ends || [])] };
      if (changed) {
        section = "starts";
        pending?.controller.abort(); pending = null; search.value = ""; searchPage = 0; message.textContent = "";
      }
    }
    if (changed || changedQuery || lastPath !== current?.path) {
      sourceLevels = null; page = 0; lastPath = current?.path;
    }
    lastGraph = current?.graph;
    if (panel.hidden || !(changed || changedQuery || graphChanged || force)) return;
    get("pathScope").textContent = current?.label || "Open a design";
    try { candidates(); drawDraft(); drawReport(); }
    catch (error) { reportFailure(error, "show-path.inspect"); }
  }
  function schedule() {
    if (frame != null) return;
    frame = doc.defaultView.requestAnimationFrame(() => { frame = null; sync(); });
  }
  const button = (label, action, index) => `<button type="button" data-path-action="${action}" data-index="${index}"${action.startsWith("tab-") ? ` aria-pressed="${action === "tab-" + section}"` : ""}>${escapeHtml(label)}</button>`;
  function findCandidates(term, pageIndex) {
    const found = [];
    if (!current || !term.trim()) return found;
    const terms = term.toLowerCase().trim().split(/\s+/);
    const skip = pageSize * pageIndex;
    let count = 0;
    for (const entry of current.index().endpoints.values()) {
      const text = (entry.label + " " + entry.kind + " " + entry.key).toLowerCase();
      if (!terms.every((term) => text.includes(term))) continue;
      if (count++ >= skip) found.push(entry);
      if (found.length > pageSize) break;
    }
    return found;
  }
  function candidates(found = findCandidates(search.value, searchPage)) {
    matches = found;
    const host = get("pathCandidates");
    if (!current || !search.value.trim()) { host.replaceChildren(); return; }
    host.innerHTML = matches.slice(0, pageSize).map((e, i) => `<div class="path-row"><span>${escapeHtml(e.label)} <small>· ${escapeHtml(e.kind)}</small></span>${button("Start +", "starts", i)}${button("End +", "ends", i)}</div>`).join("") ||
      "No matching endpoints";
    if (searchPage) host.insertAdjacentHTML("beforeend", button("Previous", "search-prev", 0));
    if (matches.length > pageSize) host.insertAdjacentHTML("beforeend", button("Next", "search-next", 0));
  }
  function drawDraft() {
    const endpoints = draft?.starts.length || draft?.ends.length ? current?.index().endpoints : null;
    get("pathDraft").innerHTML = ["starts", "ends"].map((side) => {
      const keys = draft?.[side] || [];
      const rows = keys.map((key, i) => {
        const label = endpoints?.get(key)?.label || key;
        return `<div class="path-row"><span>${escapeHtml(label)}</span><button type="button" data-path-action="remove-${side}" data-index="${i}" aria-label="Remove ${escapeHtml(label)}">×</button></div>`;
      });
      return `<section><h4>${side === "starts" ? "Starts" : "Ends"} (${keys.length})</h4>${rows.join("")}</section>`;
    }).join("");
    const toggle = panel.querySelector('[data-path-action="toggle"]');
    panel.querySelector('[data-path-action="clear"]').hidden = !current?.query && !draft?.starts.length && !draft?.ends.length;
    toggle.hidden = !current?.query;
    toggle.textContent = current?.query?.enabled ? "Turn off" : "Turn on";
    panel.querySelector('[data-path-action="cancel"]').hidden = !pending;
  }
  function drawReport() {
    const path = current?.path;
    get("pathReport").hidden = !path;
    if (!path) return;
    const entries = section === "boundaries" ? current.boundaries : path[section];
    const count = section === "levels" ? path.levels.size : entries.length;
    page = Math.min(page, Math.max(0, Math.ceil(count / pageSize) - 1));
    if (section === "levels") {
      rows = [];
      let i = 0;
      for (const row of path.levels.values()) {
        if (i++ >= page * pageSize) rows.push(row);
        if (rows.length === pageSize) break;
      }
    } else rows = entries.slice(page * pageSize, (page + 1) * pageSize);
    const summary = [path.status === "no-path" ? "No path" : path.status, ...path.reasons,
      path.nodeIds.size + " nodes", path.edgeIds.size + " wires",
      path.endpointsTruncated ? "Endpoint list truncated" : "", ...(current.notes || [])].filter(Boolean).join(" · ");
    const tabs = [button((path.automaticStarts ? "Auto starts" : "Starts") + " (" + path.startCount + ")", "tab-starts", 0),
      button((path.automaticEnds ? "Auto ends" : "Ends") + " (" + path.endCount + ")", "tab-ends", 0), button("Object levels", "tab-levels", 0),
      button("Boundaries (" + current.boundaries.length + ")", "tab-boundaries", 0)];
    get("pathReportBody").innerHTML = `<p class="path-report-summary">${escapeHtml(summary)}</p><div class="path-tabs">${tabs.join("")}</div>` +
      (sourceLevels ? `<p>From ${escapeHtml(sourceLevels.label)} ${button("All starts", "all", 0)}</p>` : "") +
      rows.map((r, i) => {
        const name = r.name && r.name !== r.label ? r.name + " → " + r.label : r.label;
        const visible = current.visible(r.displayId);
        const level = sourceLevels?.values.get(r.id);
        const fromOneStart = sourceLevels && section !== "boundaries";
        const reachable = fromOneStart ? sourceLevels.values.has(r.id) : r.reachable;
        const range = fromOneStart ? { ...r, min: level?.min, max: level?.max, partial: reachable && !level } : r;
        const detail = section === "boundaries" ? r.description : [levelText(range), r.boundary].filter(Boolean).join(" · ");
        return `<div class="path-row"><span>${escapeHtml(name)}<br>${escapeHtml(detail)} · ${!reachable ? "unreachable" : visible ? "visible" : "outside Focused"}</span>${button("Copy", "copy", i)}${visible ? button("Locate", "locate", i) : ""}${section === "starts" && r.reachable ? button("Distances", "from", i) : ""}</div>`;
      }).join("") + (page ? button("Previous", "prev", 0) : "") + (count > pageSize ? ` ${page + 1}/${Math.ceil(count / pageSize)} ` : "") +
      ((page + 1) * pageSize < count ? button("Next", "next", 0) : "") + button("Export SVG", "export", 0);
  }
  function add(key, side) {
    if (!current || !key || !current.index().endpoints.has(key)) return;
    const keys = [...new Set([...draft[side], key])];
    normalizeShowPath({ ...draft, [side]: keys });
    draft = { ...draft, [side]: keys };
    message.textContent = ""; openPanel(false); drawDraft();
  }
  async function commit(action, fromCommand = false) {
    const owner = current;
    if (!owner) return;
    if (action === "clear" && !owner.query && !pending) {
      draft = { starts: [], ends: [] }; message.textContent = ""; drawDraft(); return;
    }
    const candidate = action === "clear" ? null : normalizeShowPath(action === "toggle" ?
      { ...owner.query, enabled: !owner.query.enabled } : { ...draft, enabled: true });
    pending?.controller.abort();
    const request = { controller: new AbortController(), scope: owner.scope, draft, queryKey: JSON.stringify(candidate), keepDraft: action === "toggle" };
    const { signal } = request.controller;
    pending = request; drawDraft();
    try {
      const result = await owner.apply(candidate, signal, () => request === pending && owner.scope === context()?.scope);
      if (request !== pending || signal.aborted || owner.scope !== context()?.scope || !result) {
        if (fromCommand) throw new DOMException("Path query superseded", "AbortError");
        return;
      }
      if (result) {
        saved = undefined; sync(true);
        const path = current?.path;
        message.textContent = path?.status === "no-path" ? "No path between these endpoints." : "Query applied.";
        const partial = path?.reasons.length || path?.endpointsTruncated;
        if (partial || path?.unknownDistanceCount) {
          try { log("warning", "graph", partial ? "Show Path returned partial results" : "Some Show Path distances are unknown", { ...owner.diagnostic,
            operation: "show-path.apply", code: partial ? "show-path.partial" : "show-path.distance-unknown",
            reasons: path.reasons, endpointsTruncated: path.endpointsTruncated, unknownDistanceCount: path.unknownDistanceCount,
            startCount: path.startCount, endCount: path.endCount, nodeCount: path.nodeIds.size, wireCount: path.edgeIds.size }); } catch {}
        }
      }
    } catch (error) {
      if (fromCommand) throw error;
      if (!signal.aborted) reportFailure(error, "show-path.apply", owner);
    }
    finally { if (pending === request) { pending = null; sync(true); } }
  }
  async function action(event) {
    const el = event.target.closest("[data-path-action]");
    if (!el) return;
    sync();
    const type = el.dataset.pathAction, i = Number(el.dataset.index);
    try {
      if (type === "open") { openPanel(true); return; }
      if (["apply", "clear", "toggle"].includes(type)) return await commit(type);
      if (type === "cancel") { pending?.controller.abort(); message.textContent = "Cancelled"; return; }
      if (type === "starts" || type === "ends") return add(matches[i]?.key, type);
      if (type.startsWith("remove-")) {
        const side = type.slice(7);
        draft = { ...draft, [side]: draft[side].filter((_, index) => index !== i) };
        drawDraft(); return;
      }
      if (type.startsWith("search-")) { searchPage += type === "search-prev" ? -1 : 1; candidates(); return; }
      if (type.startsWith("tab-")) { section = type.slice(4); page = 0; }
      if (type === "prev") page--;
      if (type === "next") page++;
      if (type === "export") return exportSvg(current.side);
      if (type === "copy") return await copyText(rows[i].copyName || rows[i].label);
      if (type === "locate") return current.locate(rows[i].displayId);
      if (type === "from") {
        sourceLevels = { label: rows[i].name || rows[i].label, values: current.path.fromStart(rows[i].id) }; section = "ends"; page = 0;
      }
      if (type === "all") sourceLevels = null;
      drawReport();
    } catch (error) { reportFailure(error, "show-path." + type); }
  }
  panel.addEventListener("click", action);
  showPathButton?.addEventListener("click", () => openPanel(true));
  pathToolbar?.addEventListener("click", action);
  new doc.defaultView.MutationObserver(() => {
    if (!panel.hidden) sync(true);
  }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  search.addEventListener("input", () => {
    searchPage = 0;
    try { sync(); candidates(); } catch (error) { reportFailure(error, "show-path.inspect"); }
  });
  sidePicker.addEventListener("change", () => { navigation++; explicitSide = sidePicker.value; sync(true); });
  doc.addEventListener("show-path-add", async (event) => {
    sync(); const { result, side } = event.detail;
    const owner = current, ticket = ++navigation;
    openPanel(false);
    try {
      const sideResult = await navigateResult(result, explicitSide);
      const document = context()?.diagnostic;
      if (sideResult === null || ticket !== navigation || !owner || owner.diagnostic.documentId !== document?.documentId ||
          owner.diagnostic.documentRevision !== document?.documentRevision) return;
      explicitSide = sideResult; sync(true);
      const key = current?.searchKey(result);
      if (key) { add(key, side); search.focus(); }
      else { search.value = result.label; message.textContent = "Choose the endpoint in the current module."; sync(true); }
    } catch (error) { if (ticket === navigation) reportFailure(error, "show-path.add", owner); }
  });
  get("pathSelection").addEventListener("click", (event) => {
    const side = event.target.closest("[data-path-selection]")?.dataset.pathSelection;
    navigation++; explicitSide = undefined; sync(true); if (side) try { add(selection, side); } catch (error) { reportFailure(error, "show-path.add"); }
  });
  subscribe(schedule);
  new doc.defaultView.MutationObserver(schedule).observe(get("statusBar"), { childList: true, characterData: true, subtree: true });
  sync(true);
  function requireValue(value, code, message) {
    if (!value) throw Object.assign(new Error(message), {code});
    return value;
  }
  function endpoint(name) {
    const endpoints = current.index().endpoints;
    if (endpoints.has(name)) return name;
    const matches = [];
    for (const entry of endpoints.values()) {
      if (entry.label === name) matches.push(entry.key);
    }
    if (matches.length > 1)
      throw Object.assign(new Error("Ambiguous path endpoint"), {code:"AMBIGUOUS_ENDPOINT", candidates:matches});
    return requireValue(matches[0], "ENDPOINT_NOT_FOUND", "Unknown path endpoint");
  }
  function reportPage() {
    const path = requireValue(current.path, "NO_PATH_REPORT", "Apply a path query first");
    drawReport();
    const entries = rows.map(row => {
      const range = sourceLevels?.values.get(row.id);
      return {...row, visible:current.visible(row.displayId),
        ...(sourceLevels && section !== "boundaries" ? {reachable:sourceLevels.values.has(row.id), min:range?.min, max:range?.max} : {})};
    });
    return {section, page:page + 1, status:path.status, partial:path.status === "partial" || Boolean(path.endpointsTruncated),
      reasons:path.reasons, starts:path.startCount,
      ends:path.endCount, from:sourceLevels?.label || null, entries};
  }
  function searchAt(term, targetPage) {
    requireValue(Number.isSafeInteger(targetPage) && targetPage > 0,"INVALID_ARGUMENT","Expected a positive page number");
    const found = findCandidates(term,targetPage - 1);
    requireValue(targetPage === 1 || found.length,"PAGE_OUT_OF_RANGE","Endpoint page is out of range");
    search.value = term; searchPage = targetPage - 1; candidates(found);
    return {page:targetPage, more:found.length > pageSize,
      entries:found.slice(0,pageSize).map(({key,label,kind,displayId}) => ({key,label,kind,displayId}))};
  }
  function reportAt(targetSection, targetPage) {
    const path = requireValue(current.path, "NO_PATH_REPORT", "Apply a path query first");
    requireValue(Number.isSafeInteger(targetPage) && targetPage > 0,"INVALID_ARGUMENT","Expected a positive page number");
    const count = targetSection === "levels" ? path.levels.size : targetSection === "boundaries" ? current.boundaries.length : path[targetSection].length;
    requireValue(targetPage <= Math.max(1,Math.ceil(count / pageSize)), "PAGE_OUT_OF_RANGE","Report page is out of range");
    section = targetSection; page = targetPage - 1;
    return reportPage();
  }
  return async function runPathCommand({name, args, opts}) {
    if (name === "path cancel") {
      if (opts.side) requireValue(read()?.side, "INVALID_SIDE", "Only Compare has path sides");
      const target = opts.side ? read(opts.side === "A" ? "left" : "right") : context();
      requireValue(target, "NO_DOCUMENT", "Open a design first");
      const cancelled = Boolean(pending && pending.scope === target.scope && !pending.controller.signal.aborted);
      if (cancelled) pending.controller.abort();
      return {cancelled};
    }
    if (opts.side) {
      requireValue(read()?.side, "INVALID_SIDE", "Only Compare has path sides");
      explicitSide = opts.side === "A" ? "left" : "right";
    }
    openPanel();
    requireValue(current, "NO_DOCUMENT", "Open a design first");
    const snapshot = () => ({starts:[...draft.starts], ends:[...draft.ends], enabled:Boolean(current.query?.enabled), side:current.side});
    switch (name) {
      case "path open":
      case "path draft": return snapshot();
      case "path find":
        return searchAt(args[0],Number(opts["page-number"] || 1));
      case "path add":
      case "path remove": {
        const key = {start:"starts", end:"ends"}[args[0]];
        requireValue(key, "INVALID_ARGUMENT", "Choose start or end");
        const changes = args.slice(1).map(endpoint);
        const keys = name === "path add" ? [...new Set([...draft[key],...changes])] : draft[key].filter(id => !changes.includes(id));
        const next = {...draft,[key]:keys};
        if (next.starts.length || next.ends.length) normalizeShowPath(next);
        draft = next;
        drawDraft();
        return snapshot();
      }
      case "path apply":
        await commit("apply",true);
        return reportPage();
      case "path clear": await commit("clear",true); return snapshot();
      case "path enable":
        requireValue(current.query, "NO_PATH_REPORT", "Apply a path query first");
        requireValue(["on","off"].includes(args[0]), "INVALID_ARGUMENT", "Choose on or off");
        if (Boolean(current.query.enabled) !== (args[0] === "on")) await commit("toggle",true);
        return snapshot();
      case "path report":
        requireValue(!args.length || ["starts","ends","levels","boundaries"].includes(args[0]), "INVALID_ARGUMENT", "Unknown report section");
        return reportAt(args[0] || section, Number(opts["page-number"] || 1));
      case "ui page": {
        const targetPage = Number(args[1]);
        if (args[0] === "path-search") return {list:args[0], ...searchAt(search.value,targetPage)};
        return reportAt(section,targetPage);
      }
      case "path distances": {
        const path = requireValue(current.path, "NO_PATH_REPORT", "Apply a path query first");
        if (opts.all) sourceLevels = null;
        else {
          const start = requireValue(path.starts.find(row => [row.key,row.id,row.label,row.name].includes(args[0])),
            "ENDPOINT_NOT_FOUND", "Unknown start in this report");
          requireValue(start.reachable, "UNREACHABLE", "Start is unreachable");
          sourceLevels = {label:start.name || start.label, values:path.fromStart(start.id)};
        }
        section = "ends"; page = 0;
        return reportPage();
      }
      case "path locate":
      case "path copy": {
        const row = requireValue(reportPage().entries.find(item => [item.key,item.id,item.label,item.name,item.copyName].includes(args[0])),
          "OBJECT_NOT_FOUND", "Unknown item on this report page");
        if (name === "path copy") return {text:row.copyName || row.label};
        requireValue(row.visible, "OUTSIDE_VIEW", "Report item is outside the active view");
        current.locate(row.displayId);
        return {id:row.id, displayId:row.displayId};
      }
      case "path export":
        requireValue(current.path, "NO_PATH_REPORT", "Apply a path query first");
        return {side:current.side};
    }
  };
}
