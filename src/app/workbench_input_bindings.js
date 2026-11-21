import { createQuickInputController } from "../ui/quick_input_controller.js";
import { createQuickInputElements } from "../ui/workbench_elements.js";

import { bindRemoteWorkbench } from "./remote_workbench.js";

export function remoteNetlistContext(source, module, occurrence, compare, document) {
  return {source, mode:compare.active ? "Compare" : "Single", moduleName:module?.name, occurrence,
    pair:compare.active ? [compare.leftModuleName,compare.rightModuleName] : undefined,
    activeSide:compare.active ? ({left:"A",right:"B"})[compare.activeSide] : undefined,
    documentId:document?.documentId, sourceRevision:document?.sourceRevision};
}

export function bindWorkbenchInput({ elements, document, windowTarget, importRequests,
  imports, loadNetlistText, loadLibertyText, setStatus, logProcess, ...actions }) {
  const loadText = (text, options) => imports.route(options.kind, () => options.kind === "aig"
    ? imports.openAigText(text, options) : options.kind === "liberty"
      ? loadLibertyText(text, options) : loadNetlistText(text, options));
  const quickInput = createQuickInputController({elements:createQuickInputElements(elements,document.body),
    windowTarget,importRequests,getInputPriority:imports.priority,loadText,setStatus,logProcess});
  return () => bindRemoteWorkbench({document,windowTarget,importRequests,loadText,priority:imports.priority,setStatus,logProcess,quickInput,...actions});
}
