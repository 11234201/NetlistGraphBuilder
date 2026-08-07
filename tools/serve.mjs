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

server.on("error", (error) => {
  console.error(`Failed to start preview server: ${error.message}`);
  process.exitCode = 1;
});

console.log("Starting Netlist Graph Builder preview server...");
server.listen(options.port, host, () => {
  const port = server.address().port;
  const ready = createReadyRecord(port, startupManifest);
  console.log(JSON.stringify(ready));
  if (options.openBrowser) openBrowser(buildStartupUrl(port, startupManifest));
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
