import {constants} from "node:fs";
import {opendir, realpath, open, link, rename, unlink, stat} from "node:fs/promises";
import {resolve, relative, isAbsolute, sep, basename, dirname, join} from "node:path";
import {randomUUID} from "node:crypto";

export function failure(code, message, details = {}) {
  return Object.assign(new Error(message), {code, ...details});
}
const inside = (base, path) => {
  const rel = relative(base, path);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
};
const limit = 16 * 1024 * 1024;

export async function createWorkbenchFiles(paths, protectedFile) {
  const roots = await Promise.all((paths.length ? paths : [process.cwd()]).map(async path => {
    const root = await realpath(path);
    if (!(await stat(root)).isDirectory())
      throw failure("NOT_DIRECTORY", "Invalid browse root");
    return root;
  }));
  async function allowed(path, browser) {
    const canonical = await realpath(path);
    if (protectedFile(canonical) || (browser && !roots.some(root => inside(root, canonical))))
      throw failure("ACCESS_DENIED", "Path is outside the available files");
    return canonical;
  }
  async function read(path, browser) {
    const canonical = await allowed(path, browser);
    const file =
        await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | constants.O_NONBLOCK);
    try {
      if (process.platform === "linux")
        await allowed("/proc/self/fd/" + file.fd, browser);
      const info = await file.stat({bigint: true});
      const size = Number(info.size);
      if (!info.isFile() || size > limit)
        throw failure("FILE_LIMIT", "Expected a regular file under 16 MiB");
      const buffer = Buffer.alloc(size + 1);
      let used = 0;
      while (used < buffer.length) {
        const {bytesRead} = await file.read(buffer, used, buffer.length - used);
        if (!bytesRead)
          break;
        used += bytesRead;
      }
      const after = await file.stat({bigint: true});
      if (used !== size || after.size !== info.size || after.mtimeNs !== info.mtimeNs ||
          after.ctimeNs !== info.ctimeNs)
        throw failure("FILE_CHANGED", "File changed while reading");
      return {name: basename(path), text: buffer.toString("utf8", 0, used)};
    } finally {
      await file.close();
    }
  }
  async function list(path, filter, number, browser = true, prefix = false) {
    path = await allowed(path || roots[0], browser);
    if (!Number.isInteger(number) || number < 1)
      throw failure("INVALID_ARGUMENT", "Invalid page number");
    const entries = [];
    const directory = process.platform === "linux" ?
        await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW) :
        null;
    try {
      const directoryPath = directory ? "/proc/self/fd/" + directory.fd : path;
      if (directory)
        path = await allowed(directoryPath, browser);
      const dir = await opendir(directoryPath);
      for await (const entry of dir) {
        if ((!entry.isDirectory() && !entry.isFile()) || protectedFile(join(path, entry.name)))
          continue;
        const match =
            prefix ? entry.name.startsWith(filter) : entry.name.toLowerCase().includes(filter.toLowerCase());
        if (!match)
          continue;
        entries.push({name: entry.name, directory: entry.isDirectory()});
        if (entries.length > 50000)
          throw failure("DIRECTORY_LIMIT", "Narrow the directory filter");
      }
    } finally {
      await directory?.close();
    }
    entries.sort(
        (a, b) => Number(b.directory) - Number(a.directory) ||
            (a.name < b.name     ? -1 :
                 a.name > b.name ? 1 :
                                   0));
    return {
      path,
      roots,
      entries: entries.slice((number - 1) * 100, number * 100),
      total: entries.length,
      number
    };
  }
  async function output(path, text, overwrite) {
    const parent = await realpath(dirname(path));
    const target = join(parent, basename(path));
    if (protectedFile(target))
      throw failure("ACCESS_DENIED", "Protected output");
    const tmp = join(parent, ".ngb-export-" + randomUUID());
    const file = await open(tmp, "wx", 0o600);
    try {
      try {
        await file.writeFile(text, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      if (overwrite)
        await rename(tmp, target);
      else
        await link(tmp, target);
      return {path: target, bytes: Buffer.byteLength(text)};
    } finally {
      await unlink(tmp).catch(e => {
        if (e.code !== "ENOENT")
          throw e;
      });
    }
  }
  return {roots, read, list, output, allowed};
}
