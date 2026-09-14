import {
  filterModuleHierarchy,
  getModuleHierarchyTarget,
  renderModuleHierarchyPanel
} from "./module_hierarchy_panel.js";

export function createModuleHierarchyController({
  container,
  panel = null,
  filterInput = null,
  getHierarchy,
  getCurrentModuleName,
  getCurrentOccurrenceContext,
  navigate
}) {
  if (!container || typeof getHierarchy !== "function" || typeof navigate !== "function") {
    throw new Error("Module hierarchy controller requires container, hierarchy query and navigation port");
  }
  let hierarchy = null;
  function render() {
    if (panel && !panel.open) return false;
    hierarchy = getHierarchy();
    renderFilteredHierarchy();
    return true;
  }
  function renderFilteredHierarchy() {
    const query = filterInput?.value || "";
    const filtered = filterModuleHierarchy(hierarchy, query);
    container.innerHTML = filtered
      ? renderModuleHierarchyPanel(filtered, getCurrentModuleName?.() || null, {
        currentOccurrenceContext: getCurrentOccurrenceContext?.(),
        emptyMessage: query.trim() ? "No matching module or instance" : "No modules"
      })
      : "";
  }
  function handleClick(event) {
    const moduleName = getModuleHierarchyTarget(event);
    if (!moduleName) return false;
    if (filterInput) filterInput.value = "";
    if (panel) panel.open = false;
    const link = event.target.closest?.("[data-module-hierarchy-name]");
    const hasCanonicalPath = link?.dataset && "moduleHierarchyPath" in link.dataset;
    const occurrencePath = hasCanonicalPath
      ? link.dataset.moduleHierarchyPath.split("/").filter(Boolean)
      : link?.dataset?.moduleHierarchyId
        ? link.dataset.moduleHierarchyId.split("/")
      : undefined;
    const navigation = occurrencePath
      ? { occurrencePath, rootModuleName: link?.dataset?.moduleHierarchyRoot || undefined }
      : undefined;
    const currentContext = getCurrentOccurrenceContext?.();
    if (moduleName === getCurrentModuleName?.() && (
      sameOccurrenceContext(navigation, currentContext) ||
      (!currentContext && navigation?.occurrencePath?.length === 0)
    )) return false;
    navigate(moduleName, navigation);
    return true;
  }
  function handleFilter() {
    if (panel && !panel.open) return false;
    if (!hierarchy) hierarchy = getHierarchy();
    renderFilteredHierarchy();
    return true;
  }
  container.addEventListener("click", handleClick);
  filterInput?.addEventListener("input", handleFilter);
  const handleToggle = () => {
    if (panel?.open) render();
    else hierarchy = null;
  };
  panel?.addEventListener("toggle", handleToggle);
  return Object.freeze({
    render,
    handleClick,
    handleFilter,
    dispose() {
      container.removeEventListener?.("click", handleClick);
      filterInput?.removeEventListener?.("input", handleFilter);
      panel?.removeEventListener?.("toggle", handleToggle);
    }
  });
}

function sameOccurrenceContext(left, right) {
  const leftPath = left?.occurrencePath || [];
  const rightPath = right?.occurrencePath || [];
  const leftRoot = left?.rootModuleName || null;
  const rightRoot = right?.rootModuleName || null;
  return leftRoot === rightRoot && leftPath.length === rightPath.length &&
    leftPath.every((segment, index) => segment === rightPath[index]);
}
