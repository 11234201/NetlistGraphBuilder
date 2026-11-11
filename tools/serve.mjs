import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createTerminalLog } from "./terminal_log.mjs";
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
const log = createTerminalLog("node");
process.stderr.on("error", () => {});
process.on("exit", (code) => log.write(code ? "error" : "info", "process.exit", "Launcher exiting", { exitCode: code }));
process.on("uncaughtExceptionMonitor", (error) => log.error("process.uncaught", error));
process.on("unhandledRejection", (error) => { log.error("process.rejection", error); process.exit(1); });
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
  log.error("startup.failed", error);
  process.exit(error.exitCode || 1);
}

if (options.command === "stop" || options.command === "status") {
  if (!options.stateFile) {
    log.error("arguments.invalid", new Error(`--state-file is required for ${options.command}`));
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
    log.error("session.command_failed", error, { operation: options.command });
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
    log.error("session.prepare_failed", error);
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
  const requestPath = (request.url || "/").split(/[?#]/, 1)[0];
  let stream;
  response.once("finish", () => log.request(request.method, requestPath, response.statusCode));
  response.once("close", () => {
    stream?.destroy();
    if (!response.writableFinished) log.write("warning", "http.disconnected", "Client disconnected", { method: request.method, path: requestPath });
  });
  response.on("error", (error) => log.error("http.write_failed", error, { path: requestPath }));
  function fail(error) {
    const status = error.code === "ENOENT" || error.code === "ENOTDIR" ? 404 : error instanceof URIError ? 400 : 500;
    if (status === 500) log.error("http.failed", error, { method: request.method, path: requestPath });
    if (!response.headersSent && !response.destroyed) {
      response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      response.end(status === 404 ? "Not found" : status === 400 ? "Bad request" : "Internal server error");
    } else response.destroy();
  }
  try {
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405); response.end("Method not allowed"); return; }
    const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${options.port}`}`);
    if (url.pathname === STARTUP_ENDPOINT) {
      const body = JSON.stringify(startupManifest);
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }
    const pathname = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^[/\\]+/, "");
    const filePath = resolve(root, pathname);
    const relativePath = relative(root, filePath);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath) || log.contains(filePath)) {
      response.writeHead(403); response.end("Forbidden"); return;
    }
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) { response.writeHead(404); response.end("Not found"); return; }
    response.setHeader("content-type", mimeTypes.get(extname(filePath)) || "application/octet-stream");
    if (request.method === "HEAD") { response.end(); return; }
    stream = createReadStream(filePath);
    stream.on("error", fail);
    stream.pipe(response);
  } catch (error) { fail(error); }
});

let launcherState = null;
let parentCheck = null;
let shuttingDown = false;

function shutdown(reason = "shutdown") {
  if (shuttingDown) return;
  shuttingDown = true;
  log.write("info", "server.stopping", "Stopping preview server", { reason });
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
    if (error.code !== "ENOENT") log.error("session.cleanup_failed", error);
  }
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

server.on("error", (error) => {
  log.error("server.failed", error);
  process.exitCode = 1;
});

log.write("info", "server.starting", "Starting Netlist Graph Builder preview server");
server.listen(options.port, host, () => {
  const port = server.address().port;
  const ready = createReadyRecord(port, startupManifest);
  const finishStart = async () => {
    if (options.stateFile) {
      try {
        launcherState = makeLauncherState({ port, url: ready.url, stateFile: options.stateFile });
        await writeLauncherState(launcherState);
      } catch (error) {
        log.error("session.write_failed", error);
        server.close();
        process.exitCode = 1;
        return;
      }
    }
    console.log(JSON.stringify(ready));
    log.write("info", "server.ready", "Preview server ready", { port });
    if (options.openBrowser) openBrowser(ready.url);
    if (options.parentDeath) {
      const parentPid = process.ppid;
      parentCheck = setInterval(() => {
        if (process.ppid !== parentPid || !isProcessAlive(parentPid)) shutdown("parent-exited");
      }, 500);
    }
  };
  void finishStart().catch((error) => { log.error("startup.failed", error); process.exitCode = 1; shutdown("startup-failed"); });
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
      log.error("browser.open_failed", error, { url });
    });
    child.on("exit", (code) => { if (code) log.error("browser.open_failed", new Error("Browser opener exited unsuccessfully"), { exitCode: code, url }); });
    child.unref();
  } catch (error) {
    log.error("browser.open_failed", error, { url });
  }
}
