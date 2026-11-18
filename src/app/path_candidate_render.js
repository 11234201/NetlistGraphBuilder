import { cancelSchematicRender, renderSvgSceneIntoMount } from "../render/progressiveSvgRenderer.js";

export function renderSearchFirstPlaceholder(mount, graph) {
  mount.innerHTML = `<div class="search-first-empty"><strong>Search-first mode</strong><span>${Number(graph.view.totalNodes) || 0} nodes are indexed. Search for a cell or net to open its Focused neighborhood. Add more roots to trace nearby logic, or choose Whole for an explicit overview.</span></div>`;
}

// Keep the original DOM nodes (and their listeners) until every side has
// transferred successfully. An interrupted Compare never exposes a mixed pair.
export async function preparePathCandidate(sides, isCurrent) {
  const mounts = await Promise.all(sides.map(async ({ target, workspace }) => {
    const prepared = target.ownerDocument.createElement("div");
    if (workspace.graph?.view?.mode === "search-first") renderSearchFirstPlaceholder(prepared, workspace.graph);
    else {
      const result = await renderSvgSceneIntoMount(prepared, workspace.scene, { isCurrent });
      if (result.cancelled) return null;
    }
    return { target, prepared };
  }));
  if (!isCurrent() || mounts.some((entry) => !entry)) return null;
  return { install() {
    if (!isCurrent()) return false;
    const installed = [];
    try {
      for (const { target, prepared } of mounts) {
        const previous = [...target.childNodes];
        cancelSchematicRender(target);
        target.replaceChildren(...prepared.childNodes);
        installed.push({ target, previous });
      }
      return true;
    } catch (error) {
      for (const { target, previous } of installed.reverse()) target.replaceChildren(...previous);
      throw error;
    }
  } };
}
