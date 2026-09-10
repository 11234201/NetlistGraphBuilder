import { buildModuleHierarchy } from "../domains/netlist/module_hierarchy.js";
import { getModuleHierarchyTarget, renderModuleHierarchyPanel } from "./module_hierarchy_panel.js";

export function createModuleHierarchyController({ container, getDesign, getCurrentModuleName, navigate }) {
  if (!container || typeof getDesign !== "function" || typeof navigate !== "function") {
    throw new Error("Module hierarchy controller requires container, design query and navigation port");
  }
  function render() {
    const design = getDesign();
    container.innerHTML = design
      ? renderModuleHierarchyPanel(buildModuleHierarchy(design), getCurrentModuleName?.() || null)
      : "";
  }
  function handleClick(event) {
    const moduleName = getModuleHierarchyTarget(event);
    if (!moduleName || moduleName === getCurrentModuleName?.()) return false;
    navigate(moduleName);
    return true;
  }
  container.addEventListener("click", handleClick);
  return Object.freeze({ render, handleClick });
}
