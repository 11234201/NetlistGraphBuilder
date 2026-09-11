import { createProcessLog } from "../app/processLog.js";
import { renderProcessLogEntries } from "./processLogPanel.js";

export function createProcessLogController({ elements, setStatus, copyText, downloadText, capacity = 500 }) {
  if (typeof setStatus !== "function" || typeof copyText !== "function" || typeof downloadText !== "function") {
    throw new Error("Process Log controller requires status, copy and download ports");
  }
  const log = createProcessLog({ capacity });
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
      setStatus(`Copy log failed: ${error.message}`);
    }
  }

  function exportEntries() {
    try {
      const text = log.toJsonLines(filters());
      downloadText(`${text}${text ? "\n" : ""}`, "netlist-process-log.jsonl", "application/x-ndjson");
      setStatus(`Exported ${matchingCount()} log entry(s)`);
    } catch (error) {
      setStatus(`Export log failed: ${error.message}`);
    }
  }

  function clear() {
    log.clear();
    render();
    setStatus("Process Log cleared");
  }

  elements.toggleButton.addEventListener("click", () => toggle());
  elements.levelFilter.addEventListener("change", render);
  elements.phaseFilter.addEventListener("change", render);
  elements.copyButton.addEventListener("click", copy);
  elements.exportButton.addEventListener("click", exportEntries);
  elements.clearButton.addEventListener("click", clear);

  return Object.freeze({
    append(level, phase, message, details, options = {}) {
      if (options.progressKey) log.progress({ level, phase, message, details, key: options.progressKey });
      else log.append({ level, phase, message, details });
      if (level === "error") toggle(true);
      render();
    },
    render,
    toggle,
    copy,
    export: exportEntries,
    clear,
    model: log
  });
}
