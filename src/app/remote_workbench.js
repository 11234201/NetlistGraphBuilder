import { createRemoteFileImport, compareSideFor, commandFailure } from "./remote_file_import.js";
import { createAnalysisCommands } from "./remote_analysis_commands.js";
import { errorMessage, sanitizeLogDetails } from "../foundation/log_details.js";
import { copyBrowserText } from "../platform/browser_clipboard.js";
import { createServerFilePicker } from "../ui/server_file_picker.js";

const pendingStates = new Set(["reading", "queued", "delivered", "executing"]);
const maxPendingPickerRetries = 64;
const isCancellation = error => error?.name === "AbortError" || error?.code === "CANCELLED";
const failureCode = error => typeof error?.code === "string" && error.code ? error.code : "COMMAND_FAILED";

function commandPhase(operation) {
  if (operation.startsWith("workbench.")) return "launcher";
  const [group, action] = operation.split(" ");
  if (action === "copy" || action === "export" || operation === "golden save") return "export";
  if (["hierarchy","module","search","selection","inspect","focus","viewport","view","history","compare"].includes(group)) return "navigation";
  if (["layout","adjust","net"].includes(group)) return "layout";
  if (group === "analysis" || group === "path") return "graph";
  if (group === "timing") return "timing";
  if (group === "display" || group === "ui") return "render";
  return "import";
}

export async function bindRemoteWorkbench({ document, windowTarget: w, domainWorkbench, loadText,
  importRequests, modules, readNetlist, selectModule, search, timing, priority, loadCellConfig,
  exportCurrentSvg, downloadSvg, logProcess, setStatus, navigation, runRemoteDesign, libertyController, ...extras }) {
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
    const documentKey = JSON.stringify([active.documentId, active.sourceRevision, active.graphId, active.mode, active.moduleName, active.occurrence, active.pair, active.activeSide]);
    if (documentKey !== lastDocument) { lastDocument = documentKey; documentVersion++; }
    return { ...active, page:identity?.page, documentVersion, pickerState:picker?.state() || "closed" };
  }
  function log(error, operation, requestId, details = {}) {
    if (isCancellation(error)) return;
    try {
      logProcess("error", commandPhase(operation), errorMessage(error), {
        error, operation, code:failureCode(error), requestId,
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
    if (!response.ok) throw commandFailure(result.error.code, result.error.message, {...result.error, workbenchResponse:true});
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
  const runFileImport = createRemoteFileImport({
    context, graphs:domainWorkbench.graphs, loadText, importRequests, loadCellConfig, priority, logFile:log
  });
  // Retry policy stays on this page; host protocols continue to carry ordinary file commands.
  const pickerContinuations = new Map();
  function importFiles(job) {
    const continuation = pickerContinuations.get(job.id) || job.continuation;
    pickerContinuations.delete(job.id);
    return runFileImport({...job, continuation});
  }
  async function submit(action, paths, side, parentId, continuation) {
    const argv = [...action.split(" "), ...paths, ...(side ? ["--side", side] : [])];
    if (parentId) {
      const target = context().documentVersion;
      const job = await call("picker-files", {id:parentId, argv});
      if (closing || target !== context().documentVersion) {
        throw commandFailure(closing ? "CANCELLED" : "STALE_DOCUMENT", "The file picker's target is no longer active");
      }
      return importFiles({...job, id:parentId, continuation});
    }
    if (continuation && pickerContinuations.size >= maxPendingPickerRetries)
      throw commandFailure("PICKER_RETRY_LIMIT", "Too many unconfirmed import retries. Reconnect this page before retrying.");
    const id = continuation ? w.crypto.randomUUID() : undefined;
    if (continuation) pickerContinuations.set(id, continuation);
    let reply;
    try {
      reply = await call("import", {argv, ...(id && {id})});
      while (!closing && pendingStates.has(reply.status)) {
        await sleep(160);
        reply = await call("status", {id:reply.requestId});
      }
    } catch (error) {
      // A transport failure may follow enqueueing. Keep its policy until that job is consumed.
      // Explicit host rejections cannot later execute and need no retained continuation.
      if (error?.workbenchResponse) pickerContinuations.delete(id);
      throw error;
    }
    pickerContinuations.delete(id);
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
    report:(error, details = {}) => {
      const original = error?.code === "IMPORT_FAILED" && error.files && error.cause ? error.cause : error;
      if (!error?.commandReceipt) log(original, details.operation || "files.browse", details.requestId, {
        graphId:error?.graphId, documentId:error?.documentId, documentVersion:error?.documentVersion,
        ...details, code:original?.code || details.code
      });
    }
  });
  button.onclick = () => picker.open("files import").catch(error => log(error, "files.browse"));
  for (const [id, side] of [["compareLeftFilesMenu","A"], ["compareRightFilesMenu","B"]]) {
    const item = document.createElement("button");
    item.type = "button"; item.className = "menu-action"; item.textContent = "Open from server…";
    item.onclick = () => picker.open("design add", "", side).catch(error => log(error, "files.browse"));
    document.getElementById(id).querySelector(".toolbar-menu-popover").append(item);
  }
  w.addEventListener("pagehide", () => {
    closing = true;
    pickerContinuations.clear();
    void call("leave", {}, true).catch(() => {});
  });
  w.addEventListener("pageshow", event => { if (closing && event.persisted) w.location.reload(); });

  const runAnalysis = createAnalysisCommands({document,windowTarget:w,domainWorkbench,context,exportCurrentSvg,
    setStatus,logProcess,...extras});
  async function execute(job) {
    const result = await dispatch(job);
    if (job.output && (job.opts.download || !job.opts.out && job.args[0] === "download")) {
      if (!result || typeof result.text !== "string") throw commandFailure("EXPORT_FAILED","Missing export content");
      extras.downloadText(result.text,result.name,result.mime || "text/plain");
      return {downloadTriggered:true,name:result.name};
    }
    if (job.opts.clipboard) {
      const text = typeof result === "string" ? result : result?.text;
      if (typeof text !== "string") throw commandFailure("COPY_FAILED","No text to copy");
      try { await copyBrowserText(text, w.navigator?.clipboard); }
      catch (cause) {
        if (isCancellation(cause)) throw cause;
        throw commandFailure("COPY_FAILED", errorMessage(cause), {cause});
      }
      return {text,copied:true};
    }
    return result;
  }
  async function dispatch(job) {
    const {name, args, opts} = job;
    const {mode} = context();
    const graphs = domainWorkbench.graphs;
    if (job.modes && !job.modes.includes(mode)) throw commandFailure("DOMAIN_MISMATCH","Command unavailable in this workspace");
    if (opts.side && mode !== "Compare") throw commandFailure("INVALID_SIDE","Only Compare has sides A and B");
    const navigated = await navigation?.(job);
    if (navigated !== undefined) return navigated;
    const analysis = await runAnalysis(job);
    if (analysis !== undefined) return analysis;
    const design = await runRemoteDesign?.(job);
    if (design !== undefined) return design;
    switch (name) {
      case "liberty status": return libertyController.status();
      case "liberty cancel": return libertyController.cancel();
      case "liberty unload": return libertyController.unload();
      case "aig import-mode": {
        const input = document.getElementById("aigSearchFirstInput");
        input.checked = args[0] === "search-first";
        return {mode:args[0]};
      }
      case "aig cancel-import": return domainWorkbench.cancelImport();
      case "compare design": return importFiles({...job,name:"design add",opts:{...opts,side:args[0]}});
      case "files browse":
        await picker.open(opts.action, opts.dir, opts.side, job.id);
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
        return mode === "AIG" ? { ...info, graphCount:graphs.list().length, resources:domainWorkbench.resourceUsage?.() } : info;
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
        if (job.output || opts.out || args[0] !== "download" && !opts.download) return {...result,mime:"image/svg+xml"};
        downloadSvg(result);
        return {downloadTriggered:true, name:result.name};
      }
      default:
        if (job.hasInputs || job.files?.length) return importFiles(job);
        throw commandFailure("UNAVAILABLE","Command has no active workspace handler");
    }
  }

  async function receive(lane) {
    let healthy = true, pending = null;
    while (!closing) {
      try {
        if (!pending) {
          const polled = await call("poll", {lane, ...(lane !== "cancel" && {context:context()}), waitMs:5000});
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
              const scope = {side:job.side || job.opts.side, graphId:target.graphId,
                moduleName:target.moduleName, documentId:target.documentId, documentVersion:target.documentVersion};
              // A failed batch already logged each file. Correlate the command
              // with its original error and keep the batch summary in the receipt.
              const loggedError = error.code === "IMPORT_FAILED" && error.files && error.cause ? error.cause : error;
              log(loggedError, job.name, job.id, scope);
              const message = errorMessage(error);
              const code = isCancellation(error) ? "CANCELLED" : failureCode(error);
              if (!closing && code !== "CANCELLED" && code !== "STALE_DOCUMENT" &&
                  target.documentVersion === context().documentVersion) setStatus(message);
              pending.ack = {error:{
                code, message, candidates:error?.candidates, files:error?.files,
                ...(error?.continuation && {continuation:error.continuation, targetContext:error.targetContext}),
                details:sanitizeLogDetails({error,operation:job.name,code,requestId:job.id,page:identity.page,...scope})
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
  if (identity.cancelLane) await Promise.all([receive("work"),receive("cancel")]);
  else await receive("");
}
