import { aigLevelFailureDetails, requireAigLevelTarget } from "./aig_level_input.js";
import { getQuickInputPriority } from "./quickInput.js";

export function forwardInputFailure(report, details) {
  try { report?.(details); } catch { /* Preserve the original failure when the diagnostic sink fails. */ }
}

export function createAigSourceActions({ windowTarget, storage, collection, open, beginImport, diagnostics,
  isActive, readSource, currentView, addGraphs, setStatus }) {
  return {
    async initialize(fallback) {
      try {
        const saved = !windowTarget.location.search ? storage.load() : null;
        if (saved) {
          const request = beginImport();
          const entry = collection.restore(saved);
          const restored = await open("aig", entry.source, { ...entry.view, source: entry.source, graphId: entry.id }, request);
          if (restored || !request.isLatest()) return;
        }
      } catch (error) { diagnostics.failure(error, "persistence", "aig.workspace.load"); }
      await fallback();
    },
    imports: Object.freeze({
      levelTarget: () => isActive() ? collection.active() : null,
      openAigText(text, { label, request, append, presentationPolicy, deferLayout, levelFile, onFailureContext = () => {} }) {
        const input = { text, name: label, ...(levelFile ? { levelFile } : {}) };
        if (append) return addGraphs([input], request).catch((error) => {
          if (levelFile && error.name !== "AbortError") forwardInputFailure(onFailureContext, aigLevelFailureDetails(input, error));
          throw error;
        });
        const focus = deferLayout === undefined ? undefined : { viewMode: deferLayout ? "search-first" : "whole" };
        return open("aig", input, { presentationPolicy, focus }, beginImport(request), onFailureContext);
      },
      async loadLevelText(text, { label, request, levelTarget, onFailureContext = () => {} }) {
        const graphId = isActive() && readSource() ? collection.active() : null;
        try { requireAigLevelTarget(graphId, levelTarget); }
        catch (error) {
          forwardInputFailure(onFailureContext, { operation: "aig.level.import", domainId: "aig",
            graphId: levelTarget === undefined ? graphId : levelTarget, activeGraphId: graphId, fileName: label });
          throw error;
        }
        return open("aig", { ...readSource(), levelFile: { name: label, text } },
          { ...currentView(), graphId, levelUpdate: true }, beginImport(request), onFailureContext);
      },
      route(kind, run) {
        if (isActive() && kind !== "netlist" && kind !== "aig" && kind !== "level") { setStatus("This import is unavailable in the current view. Open a netlist first."); return Promise.resolve(null); }
        return run();
      },
      // Leave the domain successfully before applying Netlist-only attachments.
      // Within Netlist, keep the existing library-first batch policy.
      priority: (kind) => isActive() && kind === "netlist" ? -2 : getQuickInputPriority(kind)
    })
  };
}
