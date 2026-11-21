import { mkdir, readFile, link, rm, writeFile, readlink, readdir, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { workbenchCall } from "./workbench_ipc.mjs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export function resolveStateFile(value, cwd = process.cwd()) {
  return resolve(cwd, value);
}

export async function writeLauncherState(state) {
  await mkdir(dirname(state.stateFile), { recursive: true });
  const temporary = `${state.stateFile}.tmp.${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding:"utf8", mode:0o600, flag:"wx" });
  try { await link(temporary,state.stateFile); }
  finally { await rm(temporary,{force:true}); }
}

export async function readLauncherState(stateFile) {
  const text = await readFile(stateFile, "utf8");
  let state;
  try {
    state = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid Netlist Graph Builder state file: ${stateFile}`);
  }
  if (!state || state.version !== 1 || !Number.isInteger(state.pid) || state.pid <= 0 ||
      !Number.isInteger(state.port) || state.port <= 0 || state.stateFile !== resolve(stateFile)) {
    throw new Error(`Invalid Netlist Graph Builder state file: ${stateFile}`);
  }
  return state;
}

export async function removeLauncherState(stateFile) {
  await rm(stateFile, { force: true });
}

export function makeLauncherState({ port, url, stateFile }) {
  return {
    version: 1,
    pid: process.pid,
    port,
    url,
    stateFile: resolve(stateFile),
    owner: `${process.pid}-${randomUUID()}`
  };
}

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export async function belongsToLauncherState(state) {
  try {
    if (state.control) {
      if (process.platform === "linux") {
        const dir = await lstat(dirname(state.control));
        if (!dir.isDirectory() || dir.uid !== process.getuid() || (dir.mode & 0o077)) return false;
        const socket = await lstat(state.control);
        if (!socket.isSocket() || socket.uid !== process.getuid()) return false;
        const unix = await readFile("/proc/net/unix","utf8");
        const inode = unix.split("\n").map(line => /^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\d+)\s+(.+)$/.exec(line.trim())).find(row => row?.[2] === state.control)?.[1];
        if (!inode) return false;
        const folder = "/proc/"+state.pid+"/fd";
        const targets = await Promise.all((await readdir(folder)).map(fd => readlink(folder+"/"+fd).catch(() => "")));
        if (!targets.includes("socket:["+inode+"]")) return false;
      }
      const identity = await workbenchCall(state.control,{version:1,op:"identity"});
      return identity.pid === state.pid && identity.owner === state.owner && identity.stateFile === state.stateFile;
    }
    if (process.platform !== "linux") return false;
    const folder = "/proc/"+state.pid;
    const cwd = await readlink(folder+"/cwd");
    const args = (await readFile(folder+"/cmdline","utf8")).split("\0");
    const index = args.indexOf("--state-file");
    const script = fileURLToPath(new URL("./serve.mjs",import.meta.url));
    return args.some(arg => resolve(cwd,arg) === script) && index >= 0 && args[index+1] && resolve(cwd,args[index+1]) === state.stateFile;
  } catch { return false; }
}

export async function removeOwnedState(state) {
  try {
    const current = await readLauncherState(state.stateFile);
    if (current.pid === state.pid && current.owner === state.owner) await removeLauncherState(state.stateFile);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}

export async function stopLauncherState(stateFile, { force = false, quiet = false } = {}) {
  let state;
  try {
    state = await readLauncherState(stateFile);
  } catch (error) {
    if (error.code === "ENOENT") return { status: "stopped" };
    if (!quiet) throw error;
    return { status: "stale", error };
  }
  if (!isProcessAlive(state.pid)) {
    await removeOwnedState(state);
    return { status: "stopped", state };
  }
  if (!(await belongsToLauncherState(state))) {
    throw new Error(`Refusing to stop PID ${state.pid}: it does not match the Netlist Graph Builder state file`);
  }
  try {
    process.kill(state.pid, force ? "SIGKILL" : "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  const deadline = Date.now() + (force ? 1000 : 3000);
  while (isProcessAlive(state.pid) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  if (isProcessAlive(state.pid)) return { status: "running", state };
  await removeOwnedState(state);
  return { status: "stopped", state };
}

export async function launcherStatus(stateFile) {
  try {
    const state = await readLauncherState(stateFile);
    const running = isProcessAlive(state.pid) && await belongsToLauncherState(state);
    return { status: running ? "running" : "stale", state };
  } catch (error) {
    if (error.code === "ENOENT") return { status: "stopped" };
    throw error;
  }
}

export async function prepareLauncherState(stateFile, replace) {
  if (replace) {
    const previous = await stopLauncherState(stateFile);
    if (previous.status !== "stopped")
      throw new Error("The previous session is still running: " + stateFile);
    return;
  }
  let state;
  try {
    state = await readLauncherState(stateFile);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (isProcessAlive(state.pid))
    throw new Error("The state file is in use by a live process: " + stateFile);
  await removeOwnedState(state);
}
