import { errorMessage } from "../foundation/log_details.js";
import { writeProcessLogSafely } from "./processLog.js";

export function reportWorkspaceRenderFailure(error, context, { logProcess, setStatus }, onFailed) {
  const label = context.view === "compare" ? "Compare render failed" : "Render failed";
  const message = `${label}: ${errorMessage(error)}`;
  writeProcessLogSafely(logProcess, "error", "render", message, {
    ...context, operation: "render.mount", code: "render.mount-failed", error
  });
  setStatus(message);
  onFailed?.(error);
}
