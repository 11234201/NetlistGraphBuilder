// Diagnostic snapshots must remain bounded and serializable even when an error
// carries cyclic objects, hostile getters, BigInts or a large provider report.
export const LOG_DETAIL_LIMITS = Object.freeze({ depth: 6, items: 32, nodes: 256, text: 4096, characters: 16384 });
const SENSITIVE_KEY = /(?:token|secret|password|source|netlist|timingText|rawText|configText)/i;
const ERROR_FIELDS = ["name", "message", "stack", "code", "diagnostic", "diagnostics", "cause", "errors", "span", "line", "column"];

export function readErrorField(value, key) {
  try { return value?.[key]; } catch { return "[Unreadable]"; }
}

export function errorMessage(error) {
  const message = readErrorField(error, "message");
  if (typeof message === "string" && message) return message.slice(0, LOG_DETAIL_LIMITS.text);
  if (error === null || typeof error !== "object" && typeof error !== "function") {
    return String(error).slice(0, LOG_DETAIL_LIMITS.text);
  }
  return "Non-Error exception";
}

export function sanitizeLogDetails(value) {
  const ancestors = new WeakSet();
  let nodes = LOG_DETAIL_LIMITS.nodes;
  let characters = LOG_DETAIL_LIMITS.characters;
  function text(value) {
    const length = Math.min(LOG_DETAIL_LIMITS.text, Math.max(0, characters));
    const result = value.slice(0, length);
    characters -= result.length;
    return result.length < value.length ? `${result}[Truncated]` : result;
  }
  function visit(item, depth) {
    if (--nodes < 0 || characters <= 0) return "[Truncated]";
    if (typeof item === "string") return text(item);
    if (item == null || typeof item === "boolean") return item ?? null;
    if (typeof item === "number") return Number.isFinite(item) ? item : String(item);
    if (typeof item !== "object") return text(typeof item === "function" ? "[Function]" : String(item));
    if (ancestors.has(item)) return "[Circular]";
    if (depth >= LOG_DETAIL_LIMITS.depth) return "[Max depth]";
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        const result = [];
        const length = Math.min(item.length, LOG_DETAIL_LIMITS.items);
        for (let index = 0; index < length && nodes > 0 && characters > 0; index += 1) {
          result.push(visit(readErrorField(item, index), depth + 1));
        }
        if (result.length < item.length) result.push("[Truncated]");
        return result;
      }
      // Error's useful fields are non-enumerable; do not invoke toJSON hooks.
      const isError = item instanceof Error || Object.prototype.toString.call(item) === "[object Error]";
      const keys = isError ? ERROR_FIELDS : Object.keys(item);
      const result = [];
      for (const key of keys) {
        if (SENSITIVE_KEY.test(key)) continue;
        if (result.length >= LOG_DETAIL_LIMITS.items || nodes <= 0 || characters <= 0) {
          result.push(["_truncated", true]);
          break;
        }
        const child = readErrorField(item, key);
        if (child !== undefined) result.push([text(key), visit(child, depth + 1)]);
      }
      return Object.fromEntries(result);
    } catch {
      return "[Unreadable]";
    } finally {
      ancestors.delete(item);
    }
  }
  return visit(value, 0);
}
