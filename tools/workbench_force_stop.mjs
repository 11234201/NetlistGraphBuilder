import {writeFileSync} from "node:fs";
import {lstat, readFile, rmdir, unlink} from "node:fs/promises";
import {execFile} from "node:child_process";
import {basename, join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {verifyUnixSocket} from "./workbench_ipc.mjs";

const run = promisify(execFile);
const recordName = "force-owner.json";
const mismatch = () => Object.assign(new Error("Force-stop session owner does not match"), {code:"OWNER_MISMATCH"});

export function registerForceIdentity(directory, state) {
  state.forceSession = basename(directory);
  const {pid, owner, control, stateFile} = state;
  writeFileSync(join(directory, recordName), JSON.stringify({pid, owner, control, stateFile}), {flag:"wx", mode:0o600});
}

export async function forceNodeSession(state, verifiedLegacy = false) {
  let directory;
  if (state.forceSession) {
    if (!/^ngb-session-[a-z0-9]{6}$/i.test(state.forceSession)) throw mismatch();
    directory = join(tmpdir(), state.forceSession);
    const file = join(directory, recordName);
    const [parent, record] = await Promise.all([lstat(directory), lstat(file)]);
    if (!parent.isDirectory() || !record.isFile() || record.size > 8192) throw mismatch();
    if (process.platform !== "win32" && (state.control !== join(directory, "control") ||
        [parent, record].some(info => info.uid !== process.getuid() || (info.mode & 0o077)))) throw mismatch();
    const owner = JSON.parse(await readFile(file, "utf8"));
    if (!["pid", "owner", "control", "stateFile"].every(key => owner[key] === state[key])) throw mismatch();
  } else if (!verifiedLegacy) throw mismatch();

  if (process.platform === "win32") {
    if (directory && state.controlSession !== state.forceSession) throw mismatch();
    const prefix = "\\\\.\\pipe\\";
    if (!state.control.startsWith(prefix) || !/^ngb-[0-9a-f-]{36}$/i.test(state.control.slice(prefix.length))) throw mismatch();
    const shell = join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
    const script = fileURLToPath(new URL("./windows-launcher/force_stop.ps1", import.meta.url));
    await run(shell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script,
      "-ExpectedPid", String(state.pid), "-PipeName", state.control.slice(prefix.length),
      ...(directory ? ["-SessionDirectory", directory] : [])], {windowsHide:true, timeout:10000,
      env:{...process.env, PSModulePath:join(process.env.SystemRoot,"System32/WindowsPowerShell/v1.0/Modules")}});
  } else {
    await verifyUnixSocket(state);
    process.kill(state.pid, "SIGKILL");
  }
  return directory;
}

// Remove only the known files of the registered session after its process exited.
export async function cleanForcedSession(directory) {
  if (!directory) return;
  for (const name of [recordName, process.platform === "win32" ? "control.key" : "control"]) {
    try { await unlink(join(directory, name)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  try { await rmdir(directory); }
  catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error; }
}
