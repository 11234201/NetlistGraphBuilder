import {realpathSync, statSync} from "node:fs";
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

// Only use this comparison to deny private paths. Browse roots retain native
// case-sensitive semantics on volumes that allow distinct names.
function privateName(path, platform) {
  return platform === "darwin" ? path.normalize("NFD").toLowerCase() : path;
}

export function withinPath(root, candidate, platform = process.platform) {
  const suffix = relative(privateName(root, platform), privateName(candidate, platform));
  return suffix !== ".." && !suffix.startsWith(".." + sep) && !isAbsolute(suffix);
}

export function privatePathGuard(stateFile, sessionDirectory, log, platform = process.platform) {
  const state = canonicalPath(stateFile);
  const session = canonicalPath(sessionDirectory);
  const privateFiles = [state, state + ".lock", state + ".tmp." + process.pid];
  return candidate => {
    if (privateFiles.some(path => relative(privateName(path, platform), privateName(candidate, platform)) === "") ||
        withinPath(session, candidate, platform) || log.contains(candidate)) return true;
    if (platform !== "darwin") return false;
    // Filesystem identity also covers aliases beyond lexical Unicode folding.
    try {
      const file = statSync(candidate, {bigint:true, throwIfNoEntry:false});
      return !!file && privateFiles.some(path => {
        const reserved = statSync(path, {bigint:true, throwIfNoEntry:false});
        return reserved && file.dev === reserved.dev && file.ino === reserved.ino;
      });
    } catch (error) {
      if (error.code === "EACCES" || error.code === "EPERM") return true;
      throw error;
    }
  };
}
