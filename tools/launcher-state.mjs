import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export function resolveStateFile(value, cwd = process.cwd()) {
  return resolve(cwd, value);
}

export async function writeLauncherState(state) {
  await mkdir(dirname(state.stateFile), { recursive: true });
  const temporary = `${state.stateFile}.tmp.${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, "utf8");
  await rename(temporary, state.stateFile);
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
  if (process.platform === "win32") return true;
  try {
    const commandLine = (await readFile(`/proc/${state.pid}/cmdline`)).toString("utf8").replaceAll("\0", " ");
    return commandLine.includes("serve.mjs") && commandLine.includes("--state-file") &&
      commandLine.includes(basename(state.stateFile));
  } catch {
    return false;
  }
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
    await removeLauncherState(stateFile);
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
  if (isProcessAlive(state.pid)) {
    if (!force) return { status: "running", state };
    try { process.kill(state.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  await removeLauncherState(stateFile);
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

export async function stateFileExists(stateFile) {
  try {
    await access(stateFile, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
