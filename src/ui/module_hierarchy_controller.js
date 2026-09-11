import { getModuleHierarchyTarget, renderModuleHierarchyPanel } from "./module_hierarchy_panel.js";

export function createModuleHierarchyController({ container, panel = null, getHierarchy, getCurrentModuleName, navigate }) {
  if (!container || typeof getHierarchy !== "function" || typeof navigate !== "function") {
    throw new Error("Module hierarchy controller requires container, hierarchy query and navigation port");
  }
  function render() {
    if (panel && !panel.open) return false;
    const hierarchy = getHierarchy();
    container.innerHTML = hierarchy
      ? renderModuleHierarchyPanel(hierarchy, getCurrentModuleName?.() || null)
      : "";
    return true;
  }
  function handleClick(event) {
    const moduleName = getModuleHierarchyTarget(event);
    if (!moduleName || moduleName === getCurrentModuleName?.()) return false;
    navigate(moduleName);
    return true;
  }
  container.addEventListener("click", handleClick);
  const handleToggle = () => { if (panel?.open) render(); };
  panel?.addEventListener("toggle", handleToggle);
  return Object.freeze({
    render,
    handleClick,
    dispose() {
      container.removeEventListener?.("click", handleClick);
      panel?.removeEventListener?.("toggle", handleToggle);
    }
  });
}
