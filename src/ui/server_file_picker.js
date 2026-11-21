const actions = ["design open", "design add", "aig open", "aig add", "timing open", "timing add",
  "files import", "liberty load", "golden load", "cell-config import"];
const sideActions = new Set(["design open", "design add", "timing open", "timing add", "files import"]);

export function createServerFilePicker({ document, list, submit, context, report }) {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = [
    '<form method="dialog"><h2>Server files</h2><p data-context></p>',
    '<label>Action <select data-action></select></label> <label>Side <select data-side><option value="">Page</option><option>A</option><option>B</option></select></label>',
    '<p><label>Browse root <select data-roots></select></label></p>',
    '<label>Directory <input data-path></label> <button type="button" data-go>Go</button> <button type="button" data-up>Parent</button>',
    '<p><label>Filter <input data-filter></label></p><div data-entries></div>',
    '<p><button type="button" data-prev>Previous</button> <span data-count></span> <button type="button" data-next>Next</button></p>',
    '<p data-status role="status"></p><ul data-results></ul>',
    '<button type="button" data-submit>Import selected</button> <button value="cancel" data-cancel>Cancel</button></form>'
  ].join("");
  document.body.append(dialog);
  const el = name => dialog.querySelector("[data-" + name + "]");
  const chosen = new Map();
  const visibleFiles = new Map();
  let path = "", number = 1, serial = 0, busy = false, listReady = false, windowsPaths = false, target;
  function syncSubmit() { el("submit").disabled = busy || !listReady || chosen.size === 0; }
  for (const name of actions) el("action").add(new Option(name, name));
  // Use the server's path syntax even when the browser runs on another OS.
  const normalized = value => windowsPaths ? value.replaceAll("\\", "/") : value;
  const directoryKey = value => normalized(value).replace(/\/$/, "");
  const join = (parent, name) => directoryKey(parent) + "/" + normalized(name);
  function syncSide() {
    el("side").disabled = context().mode !== "Compare" || !sideActions.has(el("action").value);
    if (el("side").disabled) el("side").value = "";
  }
  function showResults(files = []) {
    el("results").replaceChildren(...files.map(file => {
      const item = document.createElement("li");
      item.textContent = [file.name, file.status, file.error?.message || file.reason].filter(Boolean).join(" · ");
      return item;
    }));
  }
  function error(e) {
    el("status").textContent = e.message;
    if (e.files) showResults(e.files);
    report(e);
  }
  async function refresh(next = path, page = 1) {
    const ticket = ++serial;
    listReady = false;
    visibleFiles.clear();
    syncSubmit();
    el("entries").replaceChildren();
    el("count").textContent = "";
    for (const key of ["prev", "next", "up"]) el(key).disabled = true;
    let data;
    try { data = await list(next, el("filter").value, page); }
    catch (error) {
      if (ticket !== serial || !dialog.open) return false;
      el("status").textContent = error.message;
      throw error;
    }
    if (ticket !== serial || !dialog.open) return false;
    path = data.path; number = data.number; el("path").value = path;
    windowsPaths = data.roots.some(root => /^(?:[a-z]:[\\/]|\\\\)/i.test(root));
    el("roots").replaceChildren(...data.roots.map(root => new Option(root, root)));
    const currentRoot = data.roots.filter(root => directoryKey(path) === directoryKey(root) || normalized(path).startsWith(join(root, "")))
      .sort((a,b) => b.length - a.length)[0];
    el("roots").value = currentRoot || data.roots[0];
    for (const item of data.entries) {
      const row = document.createElement("div"), full = join(path, item.name);
      if (item.directory) {
        const button = document.createElement("button");
        button.textContent = item.name + "/"; button.type = "button";
        button.onclick = () => refresh(full).catch(error); row.append(button);
      } else {
        const label = document.createElement("label"), check = document.createElement("input");
        check.type = "checkbox"; check.checked = chosen.has(full); check.value = full;
        visibleFiles.set(full, {check, value:item.handle || full});
        if (check.checked) chosen.set(full, item.handle || full);
        check.onchange = () => {
          if (check.checked) chosen.set(full, item.handle || full);
          else chosen.delete(full);
          syncSubmit();
        };
        label.append(check, document.createTextNode(item.name)); row.append(label);
      }
      el("entries").append(row);
    }
    el("prev").disabled = number <= 1; el("next").disabled = number * 100 >= data.total;
    el("up").disabled = data.roots.some(root => directoryKey(root) === directoryKey(path));
    el("count").textContent = number + " / " + Math.max(1, Math.ceil(data.total / 100));
    listReady = true;
    syncSubmit();
    return true;
  }
  async function open(action = "design open", dir = "", side = "") {
    if (busy) throw new Error("An import is still running");
    if (!actions.includes(action)) throw new Error("Unknown file action: " + action);
    if (side && (context().mode !== "Compare" || !sideActions.has(action))) throw new Error("This action does not accept a Compare side");
    chosen.clear(); showResults(); el("status").textContent = ""; el("filter").value = "";
    el("roots").replaceChildren(); el("path").value = dir;
    el("action").value = action; el("side").value = side; syncSide();
    target = context();
    el("context").textContent = [target.page, target.source].filter(Boolean).join(" · ");
    if (!dialog.open) dialog.showModal();
    if (!await refresh(dir)) throw new DOMException("File browsing superseded", "AbortError");
  }
  async function apply(parentId) {
    if (!dialog.open) throw new Error("Open the file picker first");
    if (busy) throw new Error("An import is still running");
    if (!listReady) throw new Error("Wait for the server directory to load");
    if (!chosen.size) throw new Error("Choose a server file");
    if (target.documentVersion !== context().documentVersion) {
      const message = "The target document changed. Reopen Server files to choose the new target.";
      el("status").textContent = message;
      throw Object.assign(new Error(message), { code:"STALE_DOCUMENT", graphId:target.graphId,
        documentId:target.documentId, documentVersion:target.documentVersion });
    }
    const paths = [...chosen.keys()];
    busy = true; el("submit").disabled = true; el("cancel").disabled = true;
    el("status").textContent = "Importing selected files…";
    try {
      const result = await submit(el("action").value, [...chosen.values()], el("side").value, parentId);
      if (result.partial) {
        target = result;
        el("context").textContent = [target.page, target.source].filter(Boolean).join(" · ");
        showResults(result.files);
        // Retrying after a partial batch imports only the remaining selections.
        result.files.forEach((file, index) => { if (file.status === "committed") chosen.delete(paths[index]); });
        el("status").textContent = "Some files could not be imported.";
        await refresh();
      } else dialog.close();
      return result;
    } catch (e) {
      el("status").textContent = e.message;
      if (e.files) showResults(e.files);
      throw e;
    } finally { busy = false; syncSubmit(); el("cancel").disabled = false; }
  }
  function cancel() {
    if (busy) throw new Error("The selected files have already been submitted");
    dialog.close();
  }
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  el("action").onchange = syncSide;
  el("roots").onchange = () => refresh(el("roots").value).catch(error);
  el("go").onclick = () => refresh(el("path").value).catch(error);
  el("up").onclick = () => refresh(join(path, "..")).catch(error);
  el("prev").onclick = () => refresh(path, number-1).catch(error);
  el("next").onclick = () => refresh(path, number+1).catch(error);
  el("filter").oninput = () => refresh().catch(error);
  el("submit").onclick = () => apply().catch(error);
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
        const visible = visibleFiles.get(full);
        chosen.set(full, visible?.value || full);
        if (visible) visible.check.checked = true;
      }
      syncSubmit();
    }
  };
}
