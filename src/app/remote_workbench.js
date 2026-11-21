import { createRemoteFileImport, compareSideFor, commandFailure } from "./remote_file_import.js";
import { createServerFilePicker } from "../ui/server_file_picker.js";

const pendingStates = new Set(["reading", "queued", "delivered", "executing"]);
const isCancellation = error => error.name === "AbortError" || error.code === "CANCELLED";

export async function bindRemoteWorkbench({ document, windowTarget: w, domainWorkbench, loadText,
  importRequests, modules, readNetlist, selectModule, search, timing, priority, loadCellConfig,
  exportCurrentSvg, downloadSvg, logProcess, setStatus }) {
  const hash = new URLSearchParams(w.location.hash.slice(1));
  let storage, previous, token = hash.get("ngb");
  try {
    storage = w.sessionStorage;
    token ||= storage.getItem("ngb.remote.token");
    previous = JSON.parse(storage.getItem("ngb.remote.page") || "null");
  } catch { /* Ungrantable storage still permits pairing the current window. */ }
  if (!token) return;
  const sleep = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  let identity, picker, closing = false, documentVersion = 0, lastDocument;
  function context() {
    const domain = domainWorkbench.context();
    const active = domain.sourceLabel ? {
      source: domain.sourceLabel, mode: "AIG", documentId:domain.documentId,
      sourceRevision:domain.sourceRevision, graphId:domain.graphId
    } : readNetlist();
    const documentKey = JSON.stringify([active.documentId, active.sourceRevision, active.graphId, active.mode]);
    if (documentKey !== lastDocument) { lastDocument = documentKey; documentVersion++; }
    return { ...active, page:identity?.page, documentVersion, pickerState:picker?.state() || "closed" };
  }
  function log(error, operation, requestId, details = {}) {
    if (isCancellation(error)) return;
    try {
      const phase = operation.startsWith("workbench.") ? "launcher" : operation === "svg export" ? "export" : operation.startsWith("module ") ? "navigation" : "import";
      logProcess("error", phase, error.message, {
        error, operation, code:error.code || "COMMAND_FAILED", requestId,
        page:identity?.page, ...details
      }, { onlyIfUnreported:true });
    } catch { /* Diagnostics cannot change a command's result. */ }
  }
  async function call(op, fields = {}, keepalive = false) {
    const response = await w.fetch("/__ngb/workbench", {
      method:"POST", headers:{"content-type":"application/json"}, keepalive,
      body:JSON.stringify({version:1, op, page:identity?.page, connection:identity?.connection, ...fields})
    });
    const result = await response.json();
    if (!response.ok) throw commandFailure(result.error.code, result.error.message, result.error);
    return result;
  }
  try {
    identity = await call("join", { token, page:hash.get("page") || previous?.page,
      resume:hash.get("resume") || previous?.resume,
      reload:w.performance.getEntriesByType("navigation")[0]?.type === "reload" });
  } catch (error) { log(error, "workbench.join"); return; }
  try {
    storage?.setItem("ngb.remote.page", JSON.stringify({page:identity.page, resume:identity.resume}));
    storage?.setItem("ngb.remote.token", token);
  } catch { /* The page is paired in memory for its lifetime. */ }
  if (hash.has("ngb")) w.history.replaceState(null, "", w.location.pathname + w.location.search);
  const label = document.getElementById("remotePageLabel");
  const button = document.getElementById("serverFiles");
  label.hidden = button.hidden = false;
  label.textContent = identity.page;
  const importFiles = createRemoteFileImport({
    context, graphs:domainWorkbench.graphs, loadText, importRequests, loadCellConfig, priority, logFile:log
  });
  async function submit(action, paths, side, parentId) {
    const argv = [...action.split(" "), ...paths, ...(side ? ["--side", side] : [])];
    if (parentId) {
      const target = context().documentVersion;
      const job = await call("picker-files", {id:parentId, argv});
      if (closing || target !== context().documentVersion) {
        throw commandFailure(closing ? "CANCELLED" : "STALE_DOCUMENT", "The file picker's target is no longer active");
      }
      return importFiles({...job, id:parentId});
    }
    let reply = await call("import", {argv});
    while (!closing && pendingStates.has(reply.status)) {
      await sleep(160);
      reply = await call("status", {id:reply.requestId});
    }
    if (reply.error) {
      const error = commandFailure(reply.error.code, reply.error.message, reply.error);
      // Parsing/layout errors have already been recorded by the command actor.
      error.commandReceipt = true;
      throw error;
    }
    if (closing) throw commandFailure("CANCELLED", "Page closed");
    return reply.result;
  }
  picker = createServerFilePicker({
    document, context, list:(path, filter, number) => call("list", {path, filter, number}), submit,
    report:error => {
      if (!error.commandReceipt) log(error, "files.browse", undefined, {
        graphId:error.graphId, documentId:error.documentId, documentVersion:error.documentVersion
      });
    }
  });
  button.onclick = () => picker.open().catch(error => log(error, "files.browse"));
  for (const [id, side] of [["compareLeftFilesMenu","A"], ["compareRightFilesMenu","B"]]) {
    const item = document.createElement("button");
    item.type = "button"; item.className = "menu-action"; item.textContent = "Open from server…";
    item.onclick = () => picker.open("design add", "", side).catch(error => log(error, "files.browse"));
    document.getElementById(id).querySelector(".toolbar-menu-popover").append(item);
  }
  w.addEventListener("pagehide", () => {
    closing = true;
    void call("leave", {}, true).catch(() => {});
  });
  w.addEventListener("pageshow", event => { if (closing && event.persisted) w.location.reload(); });

  async function execute(job) {
    const {name, args, opts} = job;
    const {mode} = context();
    const graphs = domainWorkbench.graphs;
    switch (name) {
      case "files browse":
        await picker.open(opts.action, opts.dir, opts.side);
        return {opened:true};
      case "files choose":
        await picker.choose(args);
        return {chosen:args.length};
      case "files cancel":
        picker.cancel();
        return {cancelled:true};
      case "files submit": return picker.apply(job.id);
      case "module list":
        return (mode === "AIG" ? graphs.list() : modules()).filter(m => !opts.filter || m.name.includes(opts.filter));
      case "module open": {
        if (mode === "AIG") return graphs.select(args[0]);
        const module = modules().find(item => item.name === args[0]);
        if (!module) throw commandFailure("MODULE_NOT_FOUND", "Unknown module");
        if (!module.active) await new Promise((resolve,reject) => selectModule(module.name,{
          onRendered:resolve, onFailed:reject, onCancelled:() => reject(commandFailure("CANCELLED", "Module selection cancelled"))
        }));
        return {...module, active:true};
      }
      case "design info": {
        const info = context();
        return mode === "AIG" ? { ...info, graphCount:graphs.list().length } : info;
      }
      case "search find": {
        const hits = search(args[0]);
        if (mode !== "AIG") return hits;
        const {graphId, documentId} = context();
        return hits.map(hit => ({ ...hit, graphId, documentId }));
      }
      case "timing show": {
        if (mode === "AIG") throw commandFailure("DOMAIN_MISMATCH", "Timing reports require a netlist");
        if (mode === "Compare" && !opts.side) throw commandFailure("SIDE_REQUIRED", "Choose side A or B", {candidates:["A","B"]});
        return timing(args[0], compareSideFor(mode, opts.side, true));
      }
      case "svg export": {
        if (mode === "Compare" && !opts.side) throw commandFailure("SIDE_REQUIRED", "Choose side A or B", {candidates:["A","B"]});
        const result = exportCurrentSvg(compareSideFor(mode, opts.side, true), true);
        if (!result) throw commandFailure("SVG_UNAVAILABLE", "SVG unavailable for the current view");
        if (opts.out || args[0] !== "download" && !opts.download) return result;
        downloadSvg(result);
        return {downloadTriggered:true, name:result.name};
      }
      default: return importFiles(job);
    }
  }

  let healthy = true, pending = null;
  while (!closing) {
    try {
      if (!pending) {
        const polled = await call("poll", {context:context(), waitMs:5000});
        label.textContent = [identity.page, polled.name].filter(Boolean).join(" · ");
        if (polled.job) pending = {job:polled.job};
      }
      if (pending && !pending.ack) {
        const job = pending.job;
        if (job.hasInputs && !pending.inputsLoaded) {
          const input = await call("inputs", {id:job.id});
          if (input.error) throw commandFailure(input.error.code, input.error.message, input.error);
          if (!Array.isArray(input.files)) throw new Error("Incomplete workbench input response");
          job.files = input.files;
          pending.inputsLoaded = true;
        }
        const current = context();
        pending.target ??= current;
        const grant = await call("grant", {id:job.id, context:current});
        if (grant.granted && !closing) {
          let pulseInFlight = false;
          const timer = w.setInterval(async () => {
            if (pulseInFlight) return;
            pulseInFlight = true;
            try { await call("pulse", {id:job.id}); }
            catch { /* The final ack distinguishes expiry from a transient disconnect. */ }
            finally { pulseInFlight = false; }
          }, 10000);
          try {
            if (pending.target.documentVersion !== context().documentVersion)
              throw commandFailure("STALE_DOCUMENT", "Target document changed while awaiting command execution");
            pending.ack = {result:await execute(job)};
          }
          catch (error) {
            const target = pending.target;
            log(error, job.name, job.id, {side:job.opts.side, graphId:target.graphId,
              documentId:target.documentId, documentVersion:target.documentVersion});
            if (!closing && !isCancellation(error) && error.code !== "STALE_DOCUMENT") setStatus(error.message);
            pending.ack = {error:{
              code:isCancellation(error) ? "CANCELLED" : error.code || "COMMAND_FAILED",
              message:error.message, candidates:error.candidates, files:error.files
            }};
          } finally { w.clearInterval(timer); }
          delete job.files;
          pending.ack.context = context();
        } else pending = null;
      }
      // Keep the result until acknowledged. A lost response retries just ack,
      // including for downloads or other irreversible browser actions.
      if (pending?.ack && !closing) {
        await call("ack", {id:pending.job.id, ...pending.ack});
        pending = null;
      }
      healthy = true;
    } catch (error) {
      if (pending && ["CANCELLED", "STALE_DOCUMENT", "UNKNOWN_REQUEST", "INVALID_STATE"].includes(error.code)) {
        pending = null;
        healthy = true;
        continue;
      }
      if (!closing && healthy) log(error, "workbench.transport", pending?.job.id);
      if (error.code === "PAGE_UNAVAILABLE") {
        label.textContent = identity.page + " · disconnected";
        button.hidden = true;
        break;
      }
      healthy = false;
    }
    await sleep(healthy ? 160 : 1500);
  }
}
