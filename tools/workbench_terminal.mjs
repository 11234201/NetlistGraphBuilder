import http from "node:http";
import {randomUUID} from "node:crypto";
import {readFile, mkdtemp, rm, chmod} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {createInterface} from "node:readline";
import {workbenchCall} from "./workbench_ipc.mjs";
import {createBroker, parseCommand, errorInfo, valueOptions} from "./workbench_broker.mjs";
import {createWorkbenchFiles, failure} from "./workbench_files.mjs";

const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
export async function remoteHost(options, log) {
  const dir = await mkdtemp(join(tmpdir(), "ngb-session-"));
  const socket = process.platform === "win32" ? "\\\\.\\pipe\\ngb-" + randomUUID() : join(dir, "control");
  const state = options.stateFile || join(dir, "state.json");
  const guard = path => path === state || path === resolve(dir) ||
      path.startsWith(resolve(dir) + (process.platform === "win32" ? "\\" : "/")) || log.contains(path);
  let broker, identity;
  try {
    broker = createBroker({files: await createWorkbenchFiles(options.browseRoots || [], guard), log});
  } catch (error) {
    await rm(dir, {recursive: true, force: true});
    throw error;
  }
  async function route(req, res, admin) {
    let status = 200, data, message;
    try {
      if (req.method !== "POST" ||
          (!admin &&
           (req.headers["content-type"]?.split(";")[0] !== "application/json" || !req.headers.origin ||
            new URL(req.headers.origin).host !== req.headers.host)))
        throw failure("ACCESS_DENIED", "Invalid request origin or method");
      const parts = [];
      let size = 0;
      for await (const part of req) {
        size += part.length;
        if (size > 32 * 1024 * 1024)
          throw failure("REQUEST_LIMIT", "Request too large");
        parts.push(part);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(parts).toString("utf8"));
      } catch {
        throw failure("INVALID_ARGUMENT", "Malformed workbench JSON");
      }
      message = body;
      if (admin && body.version === 1 && body.op === "identity" && identity)
        data = identity;
      else
        data = await broker.handle(body, admin);
    } catch (error) {
      status = 400;
      const id = typeof message?.id === "string" ? message.id : undefined;
      const page = typeof message?.page === "string" ? message.page : undefined;
      data = {version: 1, status: "failed", requestId: id, page, error: errorInfo(error)};
      if (["list", "picker-files"].includes(message?.op))
        log.error(
            "workbench.files_failed", error, {operation: message.op, code: error.code, requestId: id, page});
    }
    const body = JSON.stringify(data);
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body)
    });
    res.end(body);
  }
  const control = http.createServer((req, res) => void route(req, res, true));
  await new Promise((yes, no) => {
    control.once("error", no);
    control.listen(socket, yes);
  });
  if (process.platform !== "win32")
    await chmod(socket, 0o600);
  return {
    socket,
    state,
    pair: broker.pair,
    stopPolling: broker.close,
    guard,
    route: (req, res) => route(req, res, false),
    run: b => broker.handle(b, true),
    identify(record) {
      identity = {version: 1, pid: record.pid, stateFile: record.stateFile, owner: record.owner};
    },
    async close() {
      broker.close();
      control.close();
      control.closeAllConnections();
      await rm(dir, {recursive: true, force: true});
    }
  };
}

async function execute(run, argv, ctx) {
  const {name, opts} = parseCommand(argv);
  const command = {version: 1, op: "command", argv, cwd: ctx.cwd, page: ctx.page, id: opts["request-id"] || randomUUID()};
  let response = await run(command);
  const deadline = Date.now() + Number(opts.timeout || 90000);
  const timedOut = () => ({
    ...response, status:"failed", jobStatus:response.status,
    error:{code:"WAIT_TIMEOUT", message:"Timed out waiting for " + (response.requestId || response.page)}
  });
  while (name === "page wait" && response.status === "waiting" && !opts.async) {
    if (Date.now() >= deadline)
      return timedOut();
    await wait(100);
    response = await run(command);
  }
  while (!opts.async && name !== "job status" && name !== "job cancel" &&
         ["reading", "queued", "delivered", "executing", "writing"].includes(response.status)) {
    if (Date.now() >= deadline)
      return timedOut();
    await wait(80);
    response = await run({version: 1, op: "status", id: response.requestId});
  }
  if (response.status === "committed") {
    if (name === "page use")
      ctx.page = response.page;
    if (name === "fs cd")
      ctx.cwd = response.result.path;
  }
  return response;
}
function tokenize(line, partial = false) {
  const argv = [];
  let word = "", quote = "", start = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote && c === quote) {
      quote = "";
      continue;
    }
    if (!quote && /\s/.test(c)) {
      if (start !== null)
        argv.push(word);
      start = null;
      word = "";
      continue;
    }
    start ??= i;
    if (!quote && (c === "\"" || c === "'")) {
      quote = c;
      continue;
    }
    if (c === "\\" && i + 1 < line.length && /[\s'"\\]/.test(line[i + 1]))
      word += line[++i];
    else
      word += c;
  }
  if (quote && !partial)
    throw failure("INVALID_ARGUMENT", "Unterminated quote");
  if (start !== null)
    argv.push(word);
  return {argv, raw: start === null ? "" : line.slice(start), word};
}
async function complete(line, host, cwd) {
  const {word, raw} = tokenize(line, true);
  const result = await host.run({version: 1, op: "command", argv: ["fs", "complete", word], cwd});
  const offset =
      Math.max(word.lastIndexOf("/"), process.platform === "win32" ? word.lastIndexOf("\\") : -1) + 1;
  const paths = result.result.entries.map(entry => {
    const value = word.slice(0, offset) + entry.name + (entry.directory ? "/" : "");
    return value.replace(/[\s'"\\]/g, c => "\\" + c);
  });
  return [paths, raw];
}
export function terminal(host, stop) {
  const ctx = {cwd: process.cwd(), page: null};
  const reader = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: !!process.stdin.isTTY,
    historySize: 0,
    completer(line, callback) {
      complete(line, host, ctx.cwd).then(result => callback(null, result), callback);
    }
  });
  (async () => {
    const prompt = () => {
      reader.setPrompt(ctx.page ? "ngb[" + ctx.page + "]> " : "ngb> ");
      reader.prompt();
    };
    prompt();
    for await (const line of reader) {
      try {
        const {argv: args} = tokenize(line);
        if (args[0] === "quit") {
          reader.close();
          stop();
          return;
        }
        if (args.length)
          process.stderr.write(JSON.stringify(await execute(host.run, args, ctx)) + "\n");
      } catch (error) {
        process.stderr.write(JSON.stringify({status: "failed", error: errorInfo(error)}) + "\n");
      }
      prompt();
    }
  })().catch(error => process.stderr.write(error.message + "\n"));
}
function tcl(value) {
  const escape = s => s === "" ?
      "{}" :
      s.replace(/[\s\\{}[\]$";]/g, c => ({"\n": "\\n", "\r": "\\r", "\t": "\\t"}[c] || "\\" + c));
  if (value === null || value === undefined)
    return "";
  if (Array.isArray(value))
    return value.map(x => escape(tcl(x))).join(" ");
  if (typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => [escape(k), escape(tcl(v))]).join(" ");
  return String(value);
}
async function readStdin(limit) {
  const parts = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > limit)
      throw failure("FILE_LIMIT", "Input too large");
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString("utf8");
}

async function readTclArguments() {
  const encoded = await readStdin(32 * 1024 * 1024 + 65536);
  const args = [];
  for (const [word] of encoded.matchAll(/\S+/g)) {
    const hex = word.slice(1);
    if (args.length >= 150 || word[0] !== "x" || hex.length % 2 || /[^0-9a-f]/i.test(hex))
      throw failure("INVALID_ARGUMENT", "Invalid Tcl argument");
    args.push(Buffer.from(hex, "hex").toString("utf8"));
  }
  return args;
}

export async function cli(argv, log) {
  let machine = false;
  let reply;
  try {
    let path, encoded = false;
    const args = [];
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--state-file")
        path = argv[++i];
      else if (arg === "--tcl")
        machine = true;
      else if (arg === "--argv-stdin")
        encoded = true;
      else {
        args.push(arg);
        if (valueOptions.has(arg) && i + 1 < argv.length)
          args.push(argv[++i]);
      }
    }
    if (!path)
      throw failure("INVALID_ARGUMENT", "A state file is required");
    const {control} = JSON.parse(await readFile(path, "utf8"));
    if (!control)
      throw failure("NO_CONTROL", "Missing control socket");
    if (encoded) {
      if (args.length)
        throw failure("INVALID_ARGUMENT", "Tcl argument input cannot be mixed with command arguments");
      args.push(...await readTclArguments());
    }
    for (let i = 0; i < args.length; i++) {
      if (valueOptions.has(args[i])) {
        i++;
      } else if (args[i] === "--stdin") {
        if (encoded)
          throw failure("INVALID_ARGUMENT", "Standard input already supplies the Tcl arguments");
        args.splice(i, 1, "--text", await readStdin(16 * 1024 * 1024));
        i++;
      }
    }
    reply = await execute(b => workbenchCall(control, b), args, {cwd: process.cwd()});
  } catch (error) {
    reply = {version: 1, status: "failed", error: errorInfo(error)};
    log.error("workbench.client_failed", error, {operation:"cmd", code:reply.error.code});
  }
  console.log(machine ? tcl(reply) : JSON.stringify(reply));
  return !machine && ["failed", "cancelled", "unknown"].includes(reply.status) ? 1 : 0;
}
