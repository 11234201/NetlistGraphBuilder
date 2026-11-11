import { appendFileSync, closeSync, mkdirSync, openSync, renameSync, constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
import { sanitizeLogDetails, errorMessage } from "../src/foundation/log_details.js";

export function createTerminalLog(runtime, env = process.env) {
  const base = process.platform === "win32" ? env.LOCALAPPDATA || tmpdir() : env.XDG_STATE_HOME || join(homedir(), ".local/state");
  const directory = resolve(env.NGB_LOG_DIR || join(base, "netlist_graph_builder/logs"));
  const prefix = `${runtime}-${Date.now()}-${process.pid}`;
  const files = { run: join(directory, `${prefix}.run.jsonl`), error: join(directory, `${prefix}.error.jsonl`) };
  const sizes = { run: 0, error: 0 };
  const configured = Number(env.NGB_LOG_MAX_BYTES);
  const limit = Number.isInteger(configured) && configured >= 1024 && configured <= 67108864 ? configured : 2097152;
  let enabled = true;
  function terminal(record) {
    try { process.stderr.write(`${JSON.stringify(record)}\n`); } catch { /* Broken diagnostic pipe must not hide the original exit status. */ }
  }
  function record(level, event, message, details) {
    return { time: new Date().toISOString(), level, runtime, pid: process.pid, event,
      message: String(message).slice(0, 4096), ...(details === undefined ? {} : { details: sanitizeLogDetails(details) }) };
  }
  function disable(error) {
    if (!enabled) return;
    enabled = false;
    terminal(record("error", "log.write_failed", "File logging unavailable; continuing on stderr", { error, directory }));
  }
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const file of Object.values(files)) closeSync(openSync(file, "wx", 0o600));
  } catch (error) { disable(error); }
  function write(level, event, message, details, consoleOutput = true) {
    const item = record(level, event, message, details);
    const line = `${JSON.stringify(item)}\n`;
    if (enabled) {
      try {
        for (const kind of level === "error" ? ["run", "error"] : ["run"]) {
          const bytes = Buffer.byteLength(line);
          if (sizes[kind] && sizes[kind] + bytes > limit) {
            renameSync(files[kind], `${files[kind]}.1`);
            sizes[kind] = 0;
          }
          appendFileSync(files[kind], line, { mode: 0o600, flag: constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW || 0) });
          sizes[kind] += bytes;
        }
      } catch (error) { disable(error); }
    }
    if (consoleOutput || !enabled) terminal(item);
  }
  const log = {
    write, files, directory,
    error: (event, error, details = {}) => write("error", event, errorMessage(error), { ...details, error }),
    request(method, path, status) {
      write(status >= 500 ? "error" : status >= 400 ? "warning" : "info", "http.response", "HTTP response", {
        method, path: String(path || "/").split(/[?#]/, 1)[0], status
      }, false);
    },
    contains(path) { const rel = relative(directory, path); return !rel || !rel.startsWith("..") && !isAbsolute(rel); }
  };
  write("info", "log.ready", "Terminal logging initialized", files);
  return log;
}
