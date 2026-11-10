export function createLibertyController({ elements, read, importText, clear, cancel, refresh, setStatus, logProcess }) {
  let generation = 0;
  function render(busy = false) {
    const library = read();
    elements.cancelButton.disabled = !busy;
    elements.clearButton.disabled = !library && !busy;
    elements.summary.textContent = busy ? "Reading Liberty…" : library
      ? `${library.sourceName} · ${library.cellCount} cells · ${library.diagnostics.length} warnings`
      : "No library loaded. Naming rules remain available.";
    elements.diagnostics.textContent = library?.diagnostics.slice(0, 20)
      .map((item) => `${item.sourceName}:${item.span.start.line}: ${item.message}`).join("\n") || "";
  }
  async function load(text, options = {}) {
    const request = ++generation;
    const isCurrent = () => request === generation && !options.signal?.aborted;
    render(true);
    try {
      const library = await importText(text, { ...options, name: options.label || options.name || "library.lib" });
      if (!isCurrent()) return;
      render();
      logProcess?.("info", "import", `Loaded Liberty ${library.sourceName}`, { cells: library.cellCount, diagnostics: library.diagnostics.length });
      try { await refresh(); }
      catch (error) {
        if (isCurrent()) setStatus(`Liberty ${library.sourceName} loaded; view refresh ${error.name === "AbortError" ? "cancelled" : "failed: " + error.message}`);
        return "liberty";
      }
      if (isCurrent()) setStatus(`Loaded Liberty ${library.sourceName}: ${library.cellCount} cells`);
      return "liberty";
    } catch (error) {
      if (isCurrent()) setStatus(error.name === "AbortError" ? "Liberty import cancelled" : `Liberty import failed: ${error.message}`);
      throw error;
    } finally { if (request === generation) render(); }
  }
  elements.cancelButton.addEventListener("click", () => {
    generation += 1; cancel(); render(); setStatus("Liberty import cancelled");
  });
  elements.clearButton.addEventListener("click", async () => {
    const request = ++generation;
    clear(); render();
    try { await refresh(); if (request === generation) setStatus("Liberty unloaded; naming rules restored"); }
    catch (error) { if (request === generation) setStatus(error.message); }
  });
  render();
  return Object.freeze({ load });
}
