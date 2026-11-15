import { createQuickInputController } from "../ui/quick_input_controller.js";
import { createQuickInputElements } from "../ui/workbench_elements.js";

export function bindWorkbenchInput({ elements, document, windowTarget, importRequests,
  imports, loadNetlistText, loadLibertyText, setStatus, logProcess }) {
  return createQuickInputController({
    elements: createQuickInputElements(elements, document.body),
    windowTarget, importRequests, getInputPriority: imports.priority,
    loadText: (text, options) => imports.route(options.kind, () => options.kind === "liberty"
      ? loadLibertyText(text, options) : loadNetlistText(text, options)),
    setStatus, logProcess
  });
}
