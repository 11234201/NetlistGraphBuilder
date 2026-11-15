import { isEditableInputTarget } from "./quick_input_controller.js";

export function handleFocusShortcut(event, focus, enabled = true) {
  if (!enabled || event.defaultPrevented || event.isComposing || event.key?.toLowerCase() !== "f"
    || event.altKey || event.ctrlKey || event.metaKey || isEditableInputTarget(event.target)
    || event.target?.closest?.("dialog[open]")) return;
  event.preventDefault();
  focus();
}
