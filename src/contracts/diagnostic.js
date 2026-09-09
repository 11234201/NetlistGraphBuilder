const SEVERITIES = new Set(["info", "warning", "error"]);

/** Creates a domain-neutral diagnostic without coupling it to UI rendering. */
export function createDiagnostic(value) {
  if (!value || !SEVERITIES.has(value.severity)) throw new Error("Diagnostic severity must be info, warning, or error");
  if (typeof value.code !== "string" || value.code.length === 0) throw new Error("Diagnostic code is required");
  if (typeof value.message !== "string" || value.message.length === 0) throw new Error("Diagnostic message is required");
  return Object.freeze({ ...value });
}
