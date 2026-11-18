import { errorMessage, sanitizeLogDetails } from "./log_details.js";

// Workers send bounded data even for non-Error or circular rejection reasons.
export function serializeWorkerError(reason) {
  const snapshot = sanitizeLogDetails(reason);
  if (snapshot && typeof snapshot === "object" && typeof snapshot.message === "string") return snapshot;
  return { name: "WorkerError", message: errorMessage(reason), cause: snapshot };
}

export function restoreWorkerError(snapshot) {
  const error = new Error(snapshot.message);
  for (const key of ["name", "stack", "cause", "code", "diagnostic", "diagnostics", "span", "line", "column", "errors"]) {
    if (Object.hasOwn(snapshot, key)) error[key] = snapshot[key];
  }
  return error;
}
