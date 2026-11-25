import { aigPathContext, pathDisplayBoundaries } from "./show_path_context.js";
import { createStandaloneSvg } from "../render/svgExport.js";
import { renderSvgScene } from "../render/svg_scene_renderer.js";
import { handleFocusShortcut } from "../ui/focus_shortcut.js";
import { searchDesignIndex } from "../search/designSearch.js";
import { sanitizeDownloadFileName } from "../platform/browser_download.js";

const passthrough = new Set(["setStatus", "logProcess", "cssEscape", "clamp", "round", "signed", "isPromise"]);

export function createDomainViewCommands({ readWorkspace, readRequest, readAnalysisSelection, netlistSearchGraph,
  canvas, mount, sessions, session, persist, collection, leave, focused, select, focusSelection,
  selectionPolicy, selectedId, structure, download, diagnostics }) {
  return {
    search(index, query) {
      const workspace = readWorkspace();
      if (!workspace) return searchDesignIndex(index, query).map((hit) => {
        const path = netlistSearchGraph?.(hit.moduleName)?.path;
        if (!path || hit.kind === "module" || path.searchKeys.has(JSON.stringify([hit.target.kind, hit.target.name]))) return hit;
        return { ...hit, detail: [hit.detail, "Outside Show Path"].filter(Boolean).join(" · "), outsidePath: true };
      });
      const matches = workspace.search(query, 100);
      return workspace.visibleNodeIds ? matches.map((match) => workspace.visibleNodeIds.has(match.id) ? match
        : { ...match, detail: [match.detail, workspace.path && !workspace.path.nodeIds.has(match.id) ? "Outside Show Path" : "Outside Focused"].filter(Boolean).join(" · ") }) : matches;
    },
    viewport: Object.freeze({
      read: () => readWorkspace() ? [{ id: "domain", mount, viewport: canvas.viewport() }] : null,
      preview(id, viewport) {
        if (!readWorkspace() || id !== "domain") return false;
        canvas.preview(viewport); return true;
      },
      commit(id, viewport) {
        if (!readWorkspace() || id !== "domain") return false;
        sessions.updateViewport(readWorkspace().sessionId, viewport); canvas.apply(); persist(); return true;
      }
    }),
    context() {
      const workspace = readWorkspace();
      return workspace ? { compareActive: false, moduleLabel: workspace.document.model.name, documentId:workspace.document.documentId, sourceRevision:workspace.document.sourceRevision, graphId:collection.active(),
      sourceLabel: workspace.document.source.name, viewMode: session().viewMode, pathEnabled: Boolean(workspace.path), providerLabel: "Graphviz" } : {};
    },
    routeCommand(name, action, args) {
      const workspace = readWorkspace();
      if (name === "loadDesign" || name === "loadQuickInputText" && args[1]?.kind === "netlist") {
        if (!workspace) { leave(); return action(...args); }
        // The importer calls this after validating the candidate and before mounting its canvas.
        const optionsIndex = name === "loadDesign" ? 3 : 1;
        const routed = [...args];
        const options = args[optionsIndex];
        routed[optionsIndex] = { ...options, onDesignParsed(...values) {
          options?.onDesignParsed?.(...values);
          leave();
        } };
        return action(...routed);
      }
      if (!workspace || passthrough.has(name)) return action(...args);
      const commands = {
        ...focused.commands,
        readShowPath: () => aigPathContext(workspace, session(), select, (candidate, signal) => {
          const result = focused.changePath(candidate);
          const request = readRequest();
          const cancel = () => request?.cancel();
          signal.addEventListener("abort", cancel, { once: true });
          return result.finally(() => signal.removeEventListener("abort", cancel));
        }),
        handleWheel: canvas.wheel, handlePointerDown: canvas.pointerDown, fitToView: canvas.fit,
        focusSelectedCell: focusSelection, activateSearchResult: (result) => select(result.id),
        persistSession: persist,
        exportCurrentSvg(side, capture = false) {
          const fileName = `${sanitizeDownloadFileName(workspace.document.source.name)}.svg`;
          try { const text = createStandaloneSvg(renderSvgScene(workspace.feature.scene(workspace, selectionPolicy(), selectedId(), structure.view())), workspace.path, workspace.analysisScopeLabel, workspace.path ? { boundaries: pathDisplayBoundaries(workspace.displayModel), visible: workspace.positionedNodes, truncated: workspace.truncated } : {});
            if (capture) return {name:fileName,text};
            download.text(text,fileName,"image/svg+xml"); }
          catch (error) {
            diagnostics.failure(error, "export", "aig.svg.export", { format: "svg", fileName });
            if (capture) throw error;
          }
        },
        handleFocusSelectedShortcut: (event) => handleFocusShortcut(event, focusSelection, Boolean(selectedId() || readAnalysisSelection()))
      };
      return commands[name]?.(...args);
    }
  };
}
