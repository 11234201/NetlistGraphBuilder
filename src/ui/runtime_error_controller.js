import { errorMessage, readErrorField } from "../foundation/log_details.js";

// Keep the browser's native console/error reporting intact. This is an observer,
// including capture-phase resource failures which do not bubble to window.
export function installRuntimeErrorHandlers({ target, report, wasReported = () => false }) {
  let reporting = false;
  function publish(error, message, context) {
    if (reporting || readErrorField(error, "name") === "AbortError" || wasReported(error)) return;
    reporting = true;
    try { report(message, { ...context, error }); }
    catch { /* A failing log sink must not produce a recursive global error. */ }
    finally { reporting = false; }
  }
  function onError(event) {
    const error = event.error;
    const resource = event.target && event.target !== target ? event.target : null;
    const fileName = String(event.filename || resource?.src || resource?.href || "").split(/[?#]/)[0];
    const message = resource ? "Resource load failed" : `Unhandled error: ${errorMessage(error ?? event.message)}`;
    publish(error, message, { eventType: "error", fileName, line: event.lineno, column: event.colno,
      ...(resource ? { elementType: resource.tagName } : {}) });
  }
  function onRejection(event) {
    publish(event.reason, `Unhandled rejection: ${errorMessage(event.reason)}`, { eventType: "unhandledrejection" });
  }
  target?.addEventListener("error", onError, true);
  target?.addEventListener("unhandledrejection", onRejection);
  return () => {
    target?.removeEventListener("error", onError, true);
    target?.removeEventListener("unhandledrejection", onRejection);
  };
}
