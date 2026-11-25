import { writeProcessLogSafely } from "./processLog.js";
// Session v1 and older Golden files can request the retired display transform.
export function warnLegacyCollapse(display, logProcess, operation) {
  if (display?.collapseLargeGroups !== true) return;
  writeProcessLogSafely(logProcess, "warning", "persistence", "Legacy group collapse was ignored while restoring the view", {
    operation, code: "display.legacy-collapse-ignored"
  });
}
