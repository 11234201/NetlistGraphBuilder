import { readdirSync, lstatSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const logName = /^(bash|node|python|native|windows)-[0-9]{1,20}-([1-9][0-9]{0,9})\.(run|error)\.jsonl(?:\.1)?$/;

// A reused PID or an inaccessible process is deliberately treated as still active.
function isInactive(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === "ESRCH"; }
}

export function cleanupTerminalLogs(directory, configured) {
  const value = String(configured ?? "");
  const days = value.length > 0 && value.length <= 4 && !/[^0-9]/.test(value) && Number(value) <= 3650 ? Number(value) : 14;
  const result = { retentionDays: days, deletedFiles: 0, deletedBytes: 0, failedFiles: 0 };
  if (!days) return result;
  const cutoff = Date.now() - days * 86400000;
  const groups = new Map();
  function failed(error) {
    if (error.code === "ENOENT") return; // Another launcher may have already cleaned it.
    result.failedFiles++;
    result.error ??= error;
  }
  try {
    for (const name of readdirSync(directory)) {
      const match = logName.exec(name);
      if (!match || match[0] !== name || Number(match[2]) > 2147483647) continue;
      const key = name.split(".", 1)[0];
      if (!groups.has(key)) groups.set(key, { pid: Number(match[2]), paths: [] });
      groups.get(key).paths.push(join(directory, name));
    }
    for (const { pid, paths } of groups.values()) {
      if (!isInactive(pid)) continue;
      const candidates = [];
      let preserve = false;
      for (const path of paths) {
        try {
          const stat = lstatSync(path);
          if (!stat.isFile() || stat.mtimeMs >= cutoff) preserve = true;
          candidates.push({ path, stat });
        } catch (error) { failed(error); preserve = true; }
      }
      if (preserve || !isInactive(pid)) continue;
      for (const { path, stat } of candidates) {
        try {
          unlinkSync(path); // Direct children only; never follows links or removes directories.
          result.deletedFiles++;
          result.deletedBytes += stat.size;
        } catch (error) { failed(error); }
      }
    }
  } catch (error) { failed(error); }
  return result;
}
