import {randomUUID} from "node:crypto";
import {mkdtemp, rm, chmod} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {createInterface} from "node:readline";
import {formatWorkbenchReply} from "./workbench_display.mjs";
import {createControlServer, workbenchCall} from "./workbench_ipc.mjs";
import {registerForceIdentity} from "./workbench_force_stop.mjs";
import {privatePathGuard} from "./workbench_paths.mjs";
import {readLauncherState} from "./launcher-state.mjs";
import {createBroker, parseCommand, errorInfo, optionValueCount} from "./workbench_broker.mjs";
import {createWorkbenchFiles, failure} from "./workbench_files.mjs";

const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
export async function remoteHost(options, log, onStop) {
  if (typeof onStop !== "function") throw new TypeError("A workbench shutdown callback is required");
  const dir = await mkdtemp(join(tmpdir(), "ngb-session-"));
  const socket = process.platform === "win32" ? "\\\\.\\pipe\\ngb-" + randomUUID() : join(dir, "control");
  const state = options.stateFile || join(dir, "state.json");
  let broker, identity, guard, control;
  try {
    guard = privatePathGuard(state, dir, log);
    broker = createBroker({files: await createWorkbenchFiles(options.browseRoots || [], guard), log});
    control = await createControlServer(dir, (req, res) => void route(req, res, true));
    control.on("tlsClientError", error => log.error("workbench.access_denied", error,
      {operation:"control.connect", code:"ACCESS_DENIED"}));
    await new Promise((yes, no) => {
      control.once("error", no);
      control.listen(socket, yes);
    });
    if (process.platform !== "win32") await chmod(socket, 0o600);
  } catch (error) {
    control?.close();
    broker?.close();
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
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw failure("INVALID_ARGUMENT", "Expected a JSON object");
      message = body;
      if (admin && body.version === 1 && body.op === "identity" && identity)
        data = identity;
      else if (admin && body.version === 1 && body.op === "stop" && identity && body.owner === identity.owner) {
        data = {version: 1, status: "stopped"};
        res.once("finish", onStop);
      }
      else
        data = await broker.handle(body, admin);
    } catch (error) {
      status = error.code === "ACCESS_DENIED" ? 403 : 400;
      const id = typeof message?.id === "string" ? message.id : undefined;
      const page = typeof message?.page === "string" ? message.page : undefined;
      data = {version: 1, status: "failed", requestId: id, page, error: errorInfo(error)};
      if (["list", "picker-files"].includes(message?.op) && error.code !== "CANCELLED")
        log.error(
            "workbench.files_failed", error, {operation: message.op, code: error.code, requestId: id, page});
      else if (status === 403)
        log.error("workbench.access_denied", error, {operation:message?.op || "request", code:error.code, requestId:id, page});
      else if (!message)
        log.error("workbench.request_failed", error, {operation:"request", code:error.code});
    }
    const body = JSON.stringify(data);
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body)
    });
    res.end(body);
  }
  return {
    socket,
    state,
    pair: broker.pair,
    stopPolling: broker.close,
    guard,
    route: (req, res) => route(req, res, false),
    run: b => broker.handle(b, true),
    identify(record) {
      record.workbenchHost = "node";
      if (process.platform === "win32") record.controlSession = basename(dir);
      registerForceIdentity(dir, record);
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

async function execute(run, argv, ctx, parsed = parseCommand(argv)) {
  const {name, opts} = parsed;
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
function promptOptions(args) {
  const words = [];
  let json = false, inlineText = false;
  for (let i = 0; i < args.length; i += 1 + optionValueCount(args[i])) {
    const arg = args[i];
    if (arg === "--json") json = true;
    if (arg === "--text") inlineText = true;
    if (!arg.startsWith("--") && words.length < 2) words.push(arg);
  }
  const remember = args.length > 0 && !inlineText && words[0] !== "text set" && words.join(" ") !== "text set";
  return {json, remember};
}

export function terminal(host, stop, log) {
  const ctx = {cwd: process.cwd(), page: null};
  const reader = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: !!process.stdin.isTTY,
    historySize: 100,
    completer(line, callback) {
      complete(line, host, ctx.cwd).then(result => callback(null, result), callback);
    }
  });
  reader.on("history", history => {
    if (!history.length) return;
    try {
      if (promptOptions(tokenize(history[0]).argv).remember) return;
    } catch { /* An unfinished quote may contain an inline document. */ }
    history.shift();
  });
  (async () => {
    const prompt = () => {
      reader.setPrompt(ctx.page ? "ngb[" + ctx.page + "]> " : "ngb> ");
      reader.prompt();
    };
    prompt();
    for await (const line of reader) {
      let json = false, command;
      try {
        const {argv: args} = tokenize(line);
        json = promptOptions(args).json;
        if (args[0] === "quit") {
          if (args.length !== 1) throw failure("INVALID_ARGUMENT","quit takes no arguments");
          reader.close();
          stop();
          return;
        }
        if (args.length) {
          const parsed = parseCommand(args);
          command = parsed.name;
          const reply = await execute(host.run, args, ctx, parsed);
          process.stderr.write((json ? JSON.stringify(reply) : formatWorkbenchReply(reply, command)) + "\n");
        }
      } catch (error) {
        const reply = {status: "failed", error: errorInfo(error)};
        if (!error.diagnosticRecorded) log.write("error", "workbench.prompt_failed", "Interactive command failed",
            {operation:command || "prompt", page:ctx.page, code:reply.error.code, error}, false);
        process.stderr.write((json ? JSON.stringify(reply) : formatWorkbenchReply(reply, command)) + "\n");
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
  let reply, command, json = !process.stdout.isTTY;
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
        for (let n = optionValueCount(arg); n > 0 && i + 1 < argv.length; n--)
          args.push(argv[++i]);
      }
    }
    json ||= promptOptions(args).json;
    if (!path)
      throw failure("INVALID_ARGUMENT", "A state file is required");
    const state = await readLauncherState(path);
    if (!state.control)
      throw failure("NO_CONTROL", "Missing control socket");
    if (encoded) {
      if (args.length)
        throw failure("INVALID_ARGUMENT", "Tcl argument input cannot be mixed with command arguments");
      args.push(...await readTclArguments());
    }
    for (let i = 0; i < args.length; i++) {
      const count = optionValueCount(args[i]);
      if (count) {
        i += count;
      } else if (args[i] === "--stdin") {
        if (encoded)
          throw failure("INVALID_ARGUMENT", "Standard input already supplies the Tcl arguments");
        args.splice(i, 1, "--text", await readStdin(16 * 1024 * 1024));
        i++;
      }
    }
    const parsed = parseCommand(args);
    command = parsed.name;
    reply = await execute(b => workbenchCall(state, b), args, {cwd: process.cwd()}, parsed);
  } catch (error) {
    reply = {version: 1, status: "failed", error: errorInfo(error)};
    log.error("workbench.client_failed", error, {operation:"cmd", code:reply.error.code});
  }
  console.log(machine ? tcl(reply) : json ? JSON.stringify(reply) : formatWorkbenchReply(reply, command));
  return !machine && ["failed", "cancelled", "unknown"].includes(reply.status) ? 1 : 0;
}
