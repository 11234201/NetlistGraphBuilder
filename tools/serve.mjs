import { createReadStream, realpathSync } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createTerminalLog } from "./terminal_log.mjs";
import { formatPromptStartup } from "./workbench_display.mjs";
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
  prepareLauncherState,
  removeOwnedState,
  stopLauncherState,
  writeLauncherState
} from "./launcher-state.mjs";

const root = realpathSync.native(fileURLToPath(new URL("..", import.meta.url)));
const host = "127.0.0.1";
const log = createTerminalLog("node");
process.stderr.on("error", () => {});
if (process.platform === "linux") process.on("SIGXFSZ", () => {});
process.on("exit", (code) => log.write(code ? "error" : "info", "process.exit", "Launcher exiting", { exitCode: code }));
process.on("uncaughtExceptionMonitor", (error) => log.error("process.uncaught", error));
process.on("unhandledRejection", (error) => { log.error("process.rejection", error); process.exit(1); });
import { cli, remoteHost, terminal } from "./workbench_terminal.mjs";
if (process.argv[2] === "cmd") process.exit(await cli(process.argv.slice(3), log));
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

if (options.stateFile) {
  try {
    await prepareLauncherState(options.stateFile, options.replaceExisting);
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

const workbench = await remoteHost(options, log, () => shutdown("control"));
const server = createServer(async (request, response) => {
  if (request.url === "/__ngb/workbench") return workbench.route(request,response);
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
    if (/%(?:2f|5c)/i.test(requestPath) || requestPath.includes("\\")) {
      response.writeHead(403); response.end("Forbidden"); return;
    }
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
    const runtimeAsset = /^(?:index\.html$|styles\.css$|(?:src|vendor|examples)\/)/;
    if (!runtimeAsset.test(relativePath.split(sep).join("/"))) { response.writeHead(403); response.end("Forbidden"); return; }
    const canonical = await realpath(filePath);
    if (!runtimeAsset.test(relative(root,canonical).split(sep).join("/")) || workbench.guard(canonical)) { response.writeHead(403); response.end("Forbidden"); return; }
    const fileStat = await stat(canonical);
    if (!fileStat.isFile()) { response.writeHead(404); response.end("Not found"); return; }
    response.setHeader("content-type", mimeTypes.get(extname(filePath)) || "application/octet-stream");
    if (request.method === "HEAD") { response.end(); return; }
    stream = createReadStream(canonical);
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
  workbench.stopPolling();
  log.write("info", "server.stopping", "Stopping preview server", { reason });
  if (parentCheck) clearInterval(parentCheck);
  if (server.listening) { server.close(); server.closeIdleConnections?.(); }
}

async function cleanupState() {
  if (!launcherState) return;
  try {
    await removeOwnedState(launcherState);
  } catch (error) {
    if (error.code !== "ENOENT") log.error("session.cleanup_failed", error);
  }
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

server.on("error", (error) => {
  log.error("server.failed", error);
  process.exitCode = 1;
  if (!server.listening) void workbench.close();
});

log.write("info", "server.starting", "Starting Netlist Graph Builder preview server");
server.listen(options.port, host, () => {
  const port = server.address().port;
  const ready = createReadyRecord(port, startupManifest);
  const finishStart = async () => {
    try {
      launcherState = makeLauncherState({port,url:ready.url,stateFile:workbench.state});
      launcherState.control = workbench.socket;
      workbench.identify(launcherState);
      ready.pairUrl = ready.url + "#ngb=" + workbench.pair;
      ready.stateFile = workbench.state;
      await writeLauncherState(launcherState);
    } catch (error) {
      log.error("session.write_failed",error);
      process.exitCode = 1;
      server.close();
      return;
    }
    const interactive = options.interactive ?? process.stdin.isTTY;
    console.log(interactive && process.stdout.isTTY ? formatPromptStartup(ready) : JSON.stringify(ready));
    log.write("info", "server.ready", "Preview server ready", { port });
    if (interactive) terminal(workbench, () => shutdown("quit"), log);
    if (options.openBrowser) openBrowser(ready.pairUrl);
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
  void cleanupState().then(() => workbench.close()).finally(() => {
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
      log.error("browser.open_failed", error);
    });
    child.on("exit", (code) => { if (code) log.error("browser.open_failed", new Error("Browser opener exited unsuccessfully"), { exitCode: code }); });
    child.unref();
  } catch (error) {
    log.error("browser.open_failed", error);
  }
}
