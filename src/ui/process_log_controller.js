import { createProcessLog } from "../app/processLog.js";
import { renderProcessLogEntries } from "./processLogPanel.js";
import { installRuntimeErrorHandlers } from "./runtime_error_controller.js";
import { errorMessage } from "../foundation/log_details.js";

export function createProcessLogController({ elements, setStatus, copyText, downloadText, windowTarget, capacity = 500 }) {
  if (typeof setStatus !== "function" || typeof copyText !== "function" || typeof downloadText !== "function") {
    throw new Error("Process Log controller requires status, copy and download ports");
  }
  const log = createProcessLog({ capacity });
  let reportedErrors = new WeakMap();
  const filters = () => ({ level: elements.levelFilter.value, phase: elements.phaseFilter.value });
  const matchingCount = () => log.entries(filters()).length;

  function render() {
    elements.count.textContent = String(log.size);
    if (elements.list.hidden) return;
    elements.list.innerHTML = renderProcessLogEntries(log.entries(filters()));
    if (elements.autoScroll.checked) elements.list.scrollTop = elements.list.scrollHeight;
  }

  function toggle(forceOpen = null) {
    const open = forceOpen === null ? elements.list.hidden : Boolean(forceOpen);
    elements.list.hidden = !open;
    elements.controls.hidden = !open;
    elements.toggleButton.setAttribute("aria-expanded", String(open));
    if (open) render();
  }

  async function copy() {
    try {
      await copyText(log.toJsonLines(filters()));
      setStatus(`Copied ${matchingCount()} log entry(s)`);
    } catch (error) {
      const message = `Copy log failed: ${errorMessage(error)}`;
      append("error", "export", message, { error, operation: "copy-log" });
      setStatus(message);
    }
  }

  function exportEntries() {
    try {
      const text = log.toJsonLines(filters());
      downloadText(`${text}${text ? "\n" : ""}`, "netlist-process-log.jsonl", "application/x-ndjson");
      setStatus(`Exported ${matchingCount()} log entry(s)`);
    } catch (error) {
      const message = `Export log failed: ${errorMessage(error)}`;
      append("error", "export", message, { error, operation: "export-log" });
      setStatus(message);
    }
  }

  function clear() {
    log.clear();
    reportedErrors = new WeakMap();
    render();
    setStatus("Process Log cleared");
  }

  elements.toggleButton.addEventListener("click", () => toggle());
  elements.levelFilter.addEventListener("change", render);
  elements.phaseFilter.addEventListener("change", render);
  elements.copyButton.addEventListener("click", copy);
  elements.exportButton.addEventListener("click", exportEntries);
  elements.clearButton.addEventListener("click", clear);

  function append(level, phase, message, details, options = {}) {
    const entry = options.progressKey
      ? log.progress({ level, phase, message, details, key: options.progressKey })
      : log.append({ level, phase, message, details });
    if (level === "error") {
      if (details?.error && (typeof details.error === "object" || typeof details.error === "function")) reportedErrors.set(details.error, entry.sequence);
      toggle(true);
    }
    render();
  }
  const dispose = installRuntimeErrorHandlers({
    target: windowTarget,
    wasReported: (error) => log.hasEntry(reportedErrors.get(error)),
    report: (message, details) => {
      append("error", "runtime", message, details);
      setStatus(message);
    }
  });

  return Object.freeze({
    append,
    dispose,
    render,
    toggle,
    copy,
    export: exportEntries,
    clear,
    model: log
  });
}
