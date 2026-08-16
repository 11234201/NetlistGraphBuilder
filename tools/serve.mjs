import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STARTUP_ENDPOINT,
  buildStartupUrl,
  createReadyRecord,
  createStartupManifest,
  getLauncherHelp,
  parseLauncherArgs
} from "./launcher-options.mjs";
import {
  isProcessAlive,
  launcherStatus,
  makeLauncherState,
  readLauncherState,
  removeLauncherState,
  stateFileExists,
  stopLauncherState,
  writeLauncherState
} from "./launcher-state.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const host = "127.0.0.1";
let options;
let startupManifest;
try {
  options = parseLauncherArgs(process.argv.slice(2));
  if (options.help) {
    console.log(getLauncherHelp());
    process.exit(0);
  }
  startupManifest = await createStartupManifest(options);
} catch (error) {
  console.error(error.message);
  process.exit(error.exitCode || 1);
}

if (options.command === "stop" || options.command === "status") {
  if (!options.stateFile) {
    console.error(`--state-file is required for ${options.command}`);
    process.exit(2);
  }
  try {
    const result = options.command === "stop"
      ? await stopLauncherState(options.stateFile, { force: options.force })
      : await launcherStatus(options.stateFile);
    if (result.state) console.log(JSON.stringify(result.state));
    console.log(`status=${result.status}`);
    process.exit(result.status === "running" && options.command === "stop" ? 1 : 0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (options.stateFile && await stateFileExists(options.stateFile)) {
  try {
    if (options.replaceExisting) {
      await stopLauncherState(options.stateFile);
    } else {
      const existing = await launcherStatus(options.stateFile);
      if (existing.status === "running") {
        throw new Error(`A Netlist Graph Builder session is already running for state file: ${options.stateFile}`);
      }
      await removeLauncherState(options.stateFile);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"], [".v", "text/plain; charset=utf-8"],
  [".sv", "text/plain; charset=utf-8"]
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${options.port}`}`);
    if (url.pathname === STARTUP_ENDPOINT) {
      const body = JSON.stringify(startupManifest);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(body);
      return;
    }
    const pathname = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^[/\\]+/, "");
    const filePath = resolve(root, pathname);
    const relativePath = relative(root, filePath);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      response.writeHead(403); response.end("Forbidden"); return;
    }
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) { response.writeHead(404); response.end("Not found"); return; }
    response.writeHead(200, { "content-type": mimeTypes.get(extname(filePath)) || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404); response.end("Not found");
  }
});

let launcherState = null;
let parentCheck = null;
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (parentCheck) clearInterval(parentCheck);
  if (server.listening) server.close();
}

async function cleanupState() {
  if (!launcherState) return;
  try {
    const current = await readLauncherState(launcherState.stateFile);
    if (current.pid === launcherState.pid && current.owner === launcherState.owner) {
      await removeLauncherState(launcherState.stateFile);
    }
  } catch (error) {
    if (error.code !== "ENOENT") console.error(`Could not remove state file: ${error.message}`);
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

server.on("error", (error) => {
  console.error(`Failed to start preview server: ${error.message}`);
  process.exitCode = 1;
});

console.log("Starting Netlist Graph Builder preview server...");
server.listen(options.port, host, () => {
  const port = server.address().port;
  const ready = createReadyRecord(port, startupManifest);
  const finishStart = async () => {
    if (options.stateFile) {
      try {
        launcherState = makeLauncherState({ port, url: ready.url, stateFile: options.stateFile });
        await writeLauncherState(launcherState);
      } catch (error) {
        console.error(`Could not write state file: ${error.message}`);
        server.close();
        process.exitCode = 1;
        return;
      }
    }
    console.log(JSON.stringify(ready));
    if (options.openBrowser) openBrowser(ready.url);
    if (options.parentDeath) {
      const parentPid = process.ppid;
      parentCheck = setInterval(() => {
        if (process.ppid !== parentPid || !isProcessAlive(parentPid)) shutdown();
      }, 500);
    }
  };
  void finishStart();
});

server.on("close", () => {
  void cleanupState().finally(() => {
    if (parentCheck) clearInterval(parentCheck);
    if (shuttingDown || process.exitCode !== undefined) process.exit(process.exitCode || 0);
  });
});

function openBrowser(url) {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", (error) => {
      console.error(`Could not open the default browser: ${error.message}`);
      console.error(`Open this address manually: ${url}`);
    });
    child.unref();
  } catch (error) {
    console.error(`Could not open the default browser: ${error.message}`);
    console.error(`Open this address manually: ${url}`);
  }
}
