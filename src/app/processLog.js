export const PROCESS_LOG_LEVELS = Object.freeze(["debug", "info", "warning", "error"]);
export const PROCESS_LOG_PHASES = Object.freeze([
  "import", "parse", "timing", "graph", "layout", "render", "navigation", "export", "launcher"
]);

const LEVEL_SET = new Set(PROCESS_LOG_LEVELS);
const PHASE_SET = new Set(PROCESS_LOG_PHASES);
const SENSITIVE_KEY = /(?:token|secret|password|source|netlist|timingText|rawText)/i;

export function createProcessLog(options = {}) {
  const capacity = normalizeCapacity(options.capacity);
  const clock = options.clock || (() => new Date());
  let sequence = 0;
  let entries = [];

  return {
    append(input) {
      const entry = normalizeEntry(input, ++sequence, clock());
      entries.push(entry);
      if (entries.length > capacity) entries = entries.slice(entries.length - capacity);
      return { ...entry };
    },
    progress(input) {
      const key = String(input?.key || "progress");
      const phase = normalizePhase(input?.phase);
      const last = entries.at(-1);
      if (last?.progressKey === key && last.phase === phase) {
        const updated = normalizeEntry({ ...input, phase, progressKey: key }, last.sequence, clock());
        entries[entries.length - 1] = updated;
        return { ...updated };
      }
      return this.append({ ...input, phase, progressKey: key });
    },
    clear() {
      entries = [];
    },
    entries(filters = {}) {
      return filterProcessLogEntries(entries, filters);
    },
    toJsonLines(filters = {}) {
      return this.entries(filters).map((entry) => JSON.stringify(entry)).join("\n");
    },
    get size() {
      return entries.length;
    }
  };
}

export function filterProcessLogEntries(entries, filters = {}) {
  const level = LEVEL_SET.has(filters.level) ? filters.level : null;
  const phase = PHASE_SET.has(filters.phase) ? filters.phase : null;
  return (entries || []).filter((entry) =>
    (!level || entry.level === level) && (!phase || entry.phase === phase)
  ).map((entry) => ({ ...entry, details: cloneDetails(entry.details) }));
}

function normalizeEntry(input, sequence, date) {
  return {
    sequence,
    timestamp: date instanceof Date ? date.toISOString() : new Date(date).toISOString(),
    level: normalizeLevel(input?.level),
    phase: normalizePhase(input?.phase),
    message: String(input?.message || ""),
    ...(input?.details === undefined ? {} : { details: sanitizeDetails(input.details) }),
    ...(input?.progressKey ? { progressKey: String(input.progressKey) } : {})
  };
}

function sanitizeDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return String(value);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .map(([key, item]) => [key, typeof item === "object" ? JSON.stringify(item) : item]));
}

function cloneDetails(value) {
  return value && typeof value === "object" ? { ...value } : value;
}

function normalizeLevel(value) {
  return LEVEL_SET.has(value) ? value : "info";
}

function normalizePhase(value) {
  return PHASE_SET.has(value) ? value : "graph";
}

function normalizeCapacity(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, 5000) : 500;
}
