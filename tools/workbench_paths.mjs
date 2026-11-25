import {realpathSync} from "node:fs";
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from "node:path";

// State and output paths may have not-yet-created components below a symlink.
export function canonicalPath(path) {
  const resolved = resolve(path);
  try { return realpathSync.native(resolved); }
  catch (error) {
    const parent = dirname(resolved);
    if (error.code !== "ENOENT" || parent === resolved) throw error;
    return join(canonicalPath(parent), basename(resolved));
  }
}

export function withinPath(root, candidate) {
  const suffix = relative(root, candidate);
  return suffix !== ".." && !suffix.startsWith(".." + sep) && !isAbsolute(suffix);
}

export function privatePathGuard(stateFile, sessionDirectory, log) {
  const state = canonicalPath(stateFile);
  const session = canonicalPath(sessionDirectory);
  const privateFiles = [state, state + ".lock", state + ".tmp." + process.pid];
  return candidate => privateFiles.some(path => relative(path, candidate) === "") ||
    withinPath(session, candidate) || log.contains(candidate);
}
