import { errorMessage } from "../foundation/log_details.js";
import { createServerFilePickerView } from "./server_file_picker_view.js";

const actions = [
  ["files import", "Auto detect", "Detect designs and attachments automatically. Select a design and its Timing or Level file together."],
  ["design open", "Open design", "Open a Verilog or AIG design, replacing the current design."],
  ["design add", "Add designs", "Add designs to the current workspace, keeping the designs already loaded."],
  ["timing open", "Load timing", "Load a timing report for the current netlist, replacing its timing data."],
  ["timing add", "Add timing", "Add timing data to the current netlist."],
  ["aig open", "Open AIG", "Open an AIG design, replacing the current design."],
  ["aig add", "Add AIGs", "Keep the current AIGs and add more graphs to this page."],
  ["level open", "Load Level", "Load or replace the Level attachment for the current AIG."],
  ["liberty load", "Load Liberty library", "Load a Liberty library for the current netlist workspace."],
  ["golden load", "Load Golden snapshot", "Restore a saved Golden snapshot."],
  ["cell-config import", "Import cell configuration", "Import cell definitions for the current netlist workspace."]
];
const sideActions = new Set(["design open", "design add", "timing open", "timing add", "files import"]);
const cancelled = error => error?.name === "AbortError" || error?.code === "CANCELLED";
const superseded = () => new DOMException("File browsing superseded", "AbortError");
const pageSize = 100;

export function createServerFilePicker({ document, list, submit, context, report, timers = globalThis }) {
  const {dialog, el} = createServerFilePickerView(document);
  const chosen = new Map(), visibleFiles = new Map();
  let path = "", number = 1, total = 0, serial = 0, requestSequence = 0, filterTimer;
  let busy = false, listReady = false, windowsPaths = false, hasParent = false, target, opener;
  let pendingDirectory = "", pendingPage = 1, selectionExpanded = false;
  let continuation;
  let pathEditVersion = 0;

  function option(label, value) {
    const item = document.createElement("option");
    item.textContent = label; item.value = value;
    return item;
  }
  const actionOptions = new Map(actions.map(([value, label]) => [value, option(label, value)]));
  el("action").append(...actionOptions.values());
  // Paths and handles belong to the server, irrespective of the browser's OS.
  const normalized = value => windowsPaths ? value.replaceAll("\\", "/") : value;
  const directoryKey = value => normalized(value).replace(/\/$/, "");
  const join = (parent, name) => directoryKey(parent) + "/" + normalized(name);
  const basename = value => normalized(value).split("/").pop() || value;

  function diagnostic(operation, requestId) {
    return {operation, requestId, page:target?.page, documentId:target?.documentId,
      documentVersion:target?.documentVersion, graphId:target?.graphId, side:el("side").value || undefined};
  }
  function reportFailure(error, details) {
    if (cancelled(error)) return;
    try {
      report?.(error, {...details, code:error?.code || (details.operation === "files.list" ? "DIRECTORY_READ_FAILED" : "IMPORT_FAILED")});
    } catch { /* A diagnostic sink must never replace the original failure. */ }
  }
  function setStatus(message = "", state = "info") {
    el("status").textContent = message;
    el("status").dataset.state = state;
  }
  function stopFilter() {
    if (filterTimer !== undefined) timers.clearTimeout(filterTimer);
    filterTimer = undefined;
  }
  function syncControls() {
    el("submit").disabled = busy || !listReady || chosen.size === 0;
    el("submit").textContent = busy ? "Importing…" : chosen.size ? "Import " + chosen.size + " file" + (chosen.size === 1 ? "" : "s") : "Import files";
    for (const key of ["cancel", "close", "roots", "path", "go", "edit-path", "filter", "filter-clear", "action"])
      el(key).disabled = busy;
    el("side").disabled = busy || el("side-field").hidden;
    el("prev").disabled = busy || !listReady || number <= 1;
    el("next").disabled = busy || !listReady || number * pageSize >= total;
    el("up").disabled = busy || !listReady || !hasParent;
    el("retry").disabled = busy;
    el("selection-clear").disabled = busy || !chosen.size;
    el("selection-toggle").disabled = !chosen.size;
    el("entries").inert = busy || !listReady;
    el("breadcrumbs").inert = busy;
    el("selected-list").inert = busy;
    dialog.setAttribute("aria-busy", String(busy));
    for (const {check, row} of visibleFiles.values()) {
      check.checked = chosen.has(check.value);
      check.disabled = busy || !listReady;
      row.classList.toggle("is-selected", check.checked);
    }
  }
  function syncAction() {
    const action = actions.find(([value]) => value === el("action").value);
    el("action-summary").textContent = action[1];
    el("action-help").textContent = action[2];
    el("side-field").hidden = target.mode !== "Compare" || !sideActions.has(action[0]);
    if (el("side-field").hidden) el("side").value = "";
    actionOptions.get("level open").disabled = target.mode !== "AIG";
    el("context").textContent = ["Target: " + (target.page || "Current page"),
      el("side").value ? "Compare " + el("side").value : target.mode === "Compare" ? "Compare workspace" : "Current workspace",
      target.source].filter(Boolean).join(" · ");
    el("context").title = el("context").textContent;
    syncControls();
  }
  function syncSelection() {
    el("selection-count").textContent = chosen.size + " file" + (chosen.size === 1 ? "" : "s") + " selected";
    if (!chosen.size) { selectionExpanded = false; continuation = undefined; }
    el("selection-panel").hidden = !selectionExpanded;
    el("selection-toggle").textContent = selectionExpanded ? "Hide selected" : "View selected";
    el("selection-toggle").setAttribute("aria-expanded", String(selectionExpanded));
    el("selected-list").replaceChildren(...[...chosen.keys()].map(full => {
      const row = document.createElement("li"), info = document.createElement("div");
      const name = document.createElement("strong"), location = document.createElement("span");
      const remove = document.createElement("button");
      row.className = "server-file-selection-row"; info.className = "server-file-selection-info";
      name.textContent = basename(full); location.textContent = full; location.title = full;
      remove.type = "button"; remove.className = "server-file-remove"; remove.textContent = "Remove";
      remove.setAttribute("aria-label", "Remove " + full);
      remove.onclick = () => {
        if (busy) return;
        chosen.delete(full); syncSelection();
        (chosen.size ? el("selection-toggle") : el("filter")).focus();
      };
      info.append(name, location); row.append(info, remove);
      return row;
    }));
    syncControls();
  }
  function showResults(files = []) {
    const labels = {committed:"Imported", failed:"Failed", skipped:"Skipped", uncommitted:"Not imported"};
    el("results").replaceChildren(...files.map(file => {
      const row = document.createElement("li"), name = document.createElement("strong"), result = document.createElement("span");
      row.className = "server-file-result"; row.dataset.state = labels[file.status] ? file.status : "uncommitted";
      name.textContent = file.name; name.title = file.name;
      result.textContent = [labels[file.status] || "Not imported", file.error?.message || file.reason].filter(Boolean).join(" · ");
      row.append(name, result);
      return row;
    }));
  }
  function retainRemaining(receipt, paths) {
    target = {...(receipt.targetContext || receipt)};
    continuation = receipt.continuation;
    receipt.files.forEach((file, index) => { if (file.status === "committed") chosen.delete(paths[index]); });
    selectionExpanded = true;
    syncAction(); syncSelection(); showResults(receipt.files);
  }
  function breadcrumbs(root) {
    const base = directoryKey(root), relative = directoryKey(path).slice(base.length).replace(/^\//, "");
    const parts = [{name:root, path:root}];
    let current = base;
    for (const name of relative.split("/").filter(Boolean)) {
      current = join(current, name); parts.push({name, path:current});
    }
    el("breadcrumbs").replaceChildren(...parts.flatMap((part, index) => {
      const button = document.createElement("button");
      button.type = "button"; button.className = "server-file-crumb";
      button.textContent = part.name; button.title = part.path;
      if (index === parts.length - 1) button.setAttribute("aria-current", "page");
      button.onclick = () => navigate(part.path);
      if (!index) return [button];
      const separator = document.createElement("span");
      separator.textContent = "/"; separator.setAttribute("aria-hidden", "true");
      return [separator, button];
    }));
  }
  function fileKind(name) {
    const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    const kinds = {v:"Verilog", sv:"Verilog", blif:"BLIF", dot:"DOT", level:"Level", lib:"Liberty", csv:"CSV", json:"JSON", rpt:"Report", txt:"Text"};
    return Object.hasOwn(kinds, extension) ? kinds[extension] : "File";
  }
  function renderEntries(entries) {
    visibleFiles.clear();
    el("entries").replaceChildren(...entries.map(item => {
      const full = join(path, item.name), row = document.createElement(item.directory ? "button" : "label");
      const icon = document.createElement("span"), name = document.createElement("span"), kind = document.createElement("span");
      row.className = "server-file-row"; row.title = full;
      icon.className = "server-file-icon"; icon.dataset.kind = item.directory ? "folder" : "file";
      icon.setAttribute("aria-hidden", "true");
      name.className = "server-file-name"; name.textContent = item.name; name.title = full;
      kind.className = "server-file-kind"; kind.textContent = item.directory ? "Folder" : fileKind(item.name);
      if (item.directory) {
        row.type = "button"; row.setAttribute("aria-label", "Open folder " + item.name);
        row.onclick = () => navigate(full);
      } else {
        const check = document.createElement("input");
        check.type = "checkbox"; check.value = full; check.setAttribute("aria-label", item.name);
        visibleFiles.set(full, {check, row, value:item.handle || full});
        if (chosen.has(full)) chosen.set(full, item.handle || full);
        check.onchange = () => {
          if (busy || !listReady) return;
          if (check.checked) chosen.set(full, item.handle || full);
          else chosen.delete(full);
          syncSelection();
        };
        row.append(check);
      }
      row.append(icon, name, kind);
      return row;
    }));
    el("entries").scrollTop = 0;
  }
  function loading() {
    listReady = false;
    el("list-region").setAttribute("aria-busy", "true");
    el("list-state").hidden = false; el("list-state").textContent = "Loading directory…";
    el("list-state").dataset.state = "loading";
    el("retry").hidden = true;
    syncControls();
  }
  async function refresh(next = path, page = 1, requestId, pathSubmission) {
    stopFilter();
    const filter = el("filter").value;
    const ticket = ++serial, scope = {...diagnostic("files.list", requestId || "picker-list-" + ++requestSequence),
      directory:next, pageNumber:page, filterActive:Boolean(filter)};
    pendingDirectory = next; pendingPage = page;
    el("edit-path").setAttribute("aria-expanded", String(!el("path-editor").hidden));
    loading();
    try {
      let data = await list(next, filter, page);
      if (ticket !== serial || !dialog.open) return false;
      const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
      if (data.number > lastPage) {
        // A live directory may shrink while browsing. Correct at most once per request.
        pendingDirectory = data.path; pendingPage = lastPage;
        scope.correctedPageNumber = lastPage;
        data = await list(data.path, filter, lastPage);
        if (ticket !== serial || !dialog.open) return false;
      }
      path = data.path; number = data.number; total = data.total;
      pendingDirectory = path; pendingPage = number;
      windowsPaths = data.roots.some(root => /^(?:[a-z]:[\\/]|\\\\)/i.test(root));
      const currentRoot = data.roots.filter(root => directoryKey(path) === directoryKey(root) || normalized(path).startsWith(join(root, "")))
        .sort((a, b) => b.length - a.length)[0] || data.roots[0];
      el("roots").replaceChildren(...data.roots.map(root => option(root, root)));
      el("roots").value = currentRoot;
      el("root-field").hidden = data.roots.length < 2;
      el("root-label").hidden = true;
      const submittedDraft = pathSubmission && pathSubmission.version === pathEditVersion && pathSubmission.value === el("path").value;
      const editingPath = submittedDraft && el("path-editor").contains(document.activeElement);
      const replacingNavigation = el("entries").contains(document.activeElement) || el("breadcrumbs").contains(document.activeElement);
      // Filtering or a late navigation response must not overwrite a newer path draft.
      if (el("path-editor").hidden || submittedDraft) el("path").value = path;
      if (submittedDraft) {
        el("path-editor").hidden = true;
        el("edit-path").setAttribute("aria-expanded", "false");
      }
      hasParent = !data.roots.some(root => directoryKey(root) === directoryKey(path));
      breadcrumbs(currentRoot); renderEntries(data.entries);
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const pageEmpty = data.entries.length === 0 && (total > 0 || number > pageCount);
      el("count").textContent = pageEmpty ? "0 of " + total + " · Page " + number + " (directory changed)" :
        (total ? (number - 1) * pageSize + 1 : 0) + "–" + Math.min(number * pageSize, total) + " of " + total + " · " + number + " / " + pageCount;
      el("list-region").setAttribute("aria-busy", "false");
      el("list-state").hidden = data.entries.length > 0;
      el("list-state").textContent = pageEmpty ? "No files on this page. The directory changed; return to the previous page." :
        filter ? "No matching files. Try a different filter." : "This directory is empty.";
      el("list-state").dataset.state = "empty";
      listReady = true; syncSelection();
      if (editingPath) el("edit-path").focus();
      else if (replacingNavigation) el("filter").focus();
      return true;
    } catch (error) {
      if (ticket !== serial || !dialog.open) return false;
      el("list-region").setAttribute("aria-busy", "false");
      el("list-state").hidden = false;
      el("list-state").dataset.state = cancelled(error) ? "empty" : "error";
      el("list-state").textContent = cancelled(error) ? "Directory loading cancelled." : "Could not load directory: " + errorMessage(error);
      el("retry").hidden = false;
      reportFailure(error, scope);
      throw error;
    }
  }
  // DOM event handlers consume failures already reported by their owning operation.
  function navigate(next = path, page = 1, pathSubmission) {
    if (busy) return;
    return refresh(next, page, undefined, pathSubmission).catch(() => {});
  }
  function submitPath() {
    return navigate(el("path").value, 1, {value:el("path").value, version:pathEditVersion});
  }
  function close() {
    ++serial; stopFilter();
    dialog.close();
    opener?.focus();
  }
  async function open(action = "design open", dir = "", side = "", requestId) {
    if (busy) throw new Error("An import is still running");
    if (!actionOptions.has(action)) throw new Error("Unknown file action: " + action);
    const current = context();
    if (action === "level open" && current.mode !== "AIG")
      throw Object.assign(new Error("Open an AIG before loading its Level file"), {code:"DOMAIN_MISMATCH"});
    if (side && (current.mode !== "Compare" || !sideActions.has(action))) throw new Error("This action does not accept a Compare side");
    stopFilter();
    chosen.clear(); visibleFiles.clear(); showResults(); setStatus(); continuation = undefined;
    path = dir; number = 1; total = 0; selectionExpanded = false; target = {...current};
    el("entries").replaceChildren(); el("breadcrumbs").replaceChildren(); el("count").textContent = "";
    el("filter").value = ""; el("filter-clear").hidden = true;
    el("roots").replaceChildren(); el("root-field").hidden = true;
    el("path").value = dir; el("path-editor").hidden = true;
    el("advanced").open = false;
    el("action").value = action; el("side").value = side;
    listReady = false; syncAction(); syncSelection();
    if (!dialog.open) {
      opener = document.activeElement;
      dialog.showModal(); el("filter").focus();
    }
    if (!await refresh(dir, 1, requestId)) throw superseded();
  }
  async function apply(parentId) {
    if (!dialog.open) throw new Error("Open the file picker first");
    if (busy) throw new Error("An import is still running");
    const scope = {...diagnostic("files.submit", parentId || "picker-submit-" + ++requestSequence),
      action:el("action").value, selectedCount:chosen.size};
    const paths = [...chosen.keys()];
    let submitted = false;
    try {
      if (!listReady) throw Object.assign(new Error("Wait for the server directory to load"), {code:"DIRECTORY_NOT_READY"});
      if (!chosen.size) throw Object.assign(new Error("Choose a server file"), {code:"NO_FILES_SELECTED"});
      if (target.documentVersion !== context().documentVersion) {
        throw Object.assign(new Error("The target document changed. Reopen Server files to choose the new target."), {
          code:"STALE_DOCUMENT", graphId:target.graphId, documentId:target.documentId, documentVersion:target.documentVersion
        });
      }
      busy = true; submitted = true; syncControls();
      setStatus("Importing selected files. Please wait…"); showResults();
      const result = await submit(el("action").value, [...chosen.values()], el("side").value, parentId, continuation);
      if (result.partial) {
        retainRemaining(result, paths);
        const committed = result.files.filter(file => file.status === "committed").length;
        setStatus(committed + " imported · " + chosen.size + " remaining. Review the results and retry the remaining files.", "warning");
        // Importing reads server files; it does not invalidate this directory or its handles.
      } else close();
      return result;
    } catch (error) {
      setStatus(cancelled(error) ? "Import cancelled." : errorMessage(error), cancelled(error) ? "info" : "error");
      if (error?.files && error.targetContext) retainRemaining(error, paths);
      else if (error?.files) showResults(error.files);
      reportFailure(error, scope);
      throw error;
    } finally {
      if (submitted) busy = false;
      syncControls();
    }
  }
  function cancel() {
    if (busy) throw new Error("The selected files have already been submitted");
    close();
  }
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    if (!busy) cancel();
  });
  dialog.addEventListener("close", () => {
    // Native close events are queued; a previous dialog session may already have reopened.
    if (!dialog.open) { ++serial; stopFilter(); }
  });
  el("form").addEventListener("submit", event => event.preventDefault());
  el("cancel").onclick = el("close").onclick = cancel;
  el("action").onchange = el("side").onchange = () => { continuation = undefined; syncAction(); };
  el("roots").onchange = () => navigate(el("roots").value);
  el("go").onclick = submitPath;
  el("up").onclick = () => navigate(join(path, ".."));
  el("prev").onclick = () => navigate(path, number - 1);
  el("next").onclick = () => navigate(path, number + 1);
  el("retry").onclick = () => navigate(pendingDirectory, pendingPage);
  el("edit-path").onclick = () => {
    pathEditVersion++;
    el("path-editor").hidden = !el("path-editor").hidden;
    el("edit-path").setAttribute("aria-expanded", String(!el("path-editor").hidden));
    if (!el("path-editor").hidden) { el("path").focus(); el("path").select(); }
  };
  el("path").oninput = () => { pathEditVersion++; };
  el("path").onkeydown = event => {
    if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); return submitPath(); }
  };
  el("filter").oninput = () => {
    stopFilter(); ++serial;
    el("filter-clear").hidden = !el("filter").value;
    loading();
    filterTimer = timers.setTimeout(() => { filterTimer = undefined; void navigate(pendingDirectory || path); }, 200);
  };
  el("filter").onkeydown = event => {
    if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); return navigate(pendingDirectory || path); }
  };
  el("filter-clear").onclick = () => {
    el("filter").value = ""; el("filter-clear").hidden = true; el("filter").focus();
    return navigate(pendingDirectory || path);
  };
  el("selection-toggle").onclick = () => { selectionExpanded = !selectionExpanded; syncSelection(); };
  el("selection-clear").onclick = () => { if (!busy) { chosen.clear(); continuation = undefined; syncSelection(); el("filter").focus(); } };
  el("submit").onclick = () => apply().catch(() => {});
  return {
    open, apply, cancel,
    state() {
      if (busy) return "busy";
      if (!dialog.open) return "closed";
      return listReady && chosen.size ? "selected" : "open";
    },
    choose(paths) {
      if (!dialog.open || busy) throw new Error("Open the file picker before choosing files");
      if (!listReady) throw Object.assign(new Error("Wait for the server directory to load"), {code:"DIRECTORY_NOT_READY"});
      for (const item of paths) {
        const name = normalized(item);
        const full = name.startsWith("/") || windowsPaths && /^[a-z]:\//i.test(name) ? name : join(path, name);
        chosen.set(full, visibleFiles.get(full)?.value || full);
      }
      syncSelection();
    }
  };
}
