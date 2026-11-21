import {readFile} from "node:fs/promises";
import {randomUUID, createHash} from "node:crypto";
import {resolve, dirname, basename} from "node:path";
import {failure} from "./workbench_files.mjs";

export const catalogue =
    JSON.parse(await readFile(new URL("../src/contracts/workbench_commands.json", import.meta.url)));
const definitions = new Map(catalogue.commands.map(row => [row.name, row]));
const inputCommands = new Set(catalogue.commands.filter(row => row.inputStart !== undefined).map(row => row.name));
export const optionValueCount = arg => arg.startsWith("--") && Object.hasOwn(catalogue.optionArity,arg.slice(2)) ? catalogue.optionArity[arg.slice(2)] : 0;
const globalOptions = new Set(["page","side","request-id","timeout","async","json"]);

export function parseCommand(argv) {
  if (!Array.isArray(argv) || argv.length > 150 || argv.some(value => typeof value !== "string"))
    throw failure("INVALID_ARGUMENT", "Invalid argument list");
  const words = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (!word.startsWith("--")) {
      words.push(word);
      continue;
    }
    const key = word.slice(2);
    if (!Object.hasOwn(catalogue.optionArity, key) || Object.hasOwn(opts, key))
      throw failure("INVALID_ARGUMENT", "Unknown or repeated option");
    const arity = catalogue.optionArity[key];
    const values = argv.slice(i + 1, i + 1 + arity);
    if (values.length !== arity || (key !== "filter" && values.includes("")))
      throw failure("INVALID_ARGUMENT", "Expected a value for --" + key);
    opts[key] = arity === 0 ? true : arity === 1 ? values[0] : values;
    i += arity;
  }
  if (!words.length) throw failure("INVALID_ARGUMENT", "Command required");
  const first = words.shift();
  const name = Object.hasOwn(catalogue.aliases, first) ? catalogue.aliases[first] :
      definitions.has(first) ? first : first + " " + (words.shift() || "");
  const def = definitions.get(name);
  if (!def || def.capability !== "v1") throw failure("UNAVAILABLE", "Unavailable command " + name);
  if (opts.side && !["A","B"].includes(opts.side)) throw failure("INVALID_ARGUMENT", "Expected side A or B");
  if (opts.side && !def.compareSide && !(name === "commands" && opts.available))
    throw failure("INVALID_SIDE", "This command does not target a Compare side");
  const invalid = () => { throw failure("INVALID_ARGUMENT", def.syntax); };
  for (const key of Object.keys(opts))
    if (!globalOptions.has(key) && !def.options?.includes(key)) invalid();
  if (opts.timeout && !/^[1-9]\d{0,7}$/.test(opts.timeout) ||
      opts["page-number"] && !/^[1-9]\d{0,6}$/.test(opts["page-number"])) invalid();
  if (opts.view && !["logic","standard","search-first"].includes(opts.view) ||
      opts["on-conflict"] && !["abort","replace"].includes(opts["on-conflict"])) invalid();
  if (opts.text !== undefined) {
    if (words.length !== def.inputStart || Buffer.byteLength(opts.text) > 16 * 1024 * 1024) invalid();
    words.push(opts.name || "pasted input");
  }
  if (opts.out || opts.download) {
    if (words.length || opts.out && opts.download) invalid();
    words.push(opts.out || "download");
  }
  if (def.alternative && opts[def.alternative]) {
    if (words.length) invalid();
  } else if (words.length < def.arguments[0] || words.length > def.arguments[1]) invalid();
  if (name !== "fs complete" && name !== "text set" && words.some(word => word === "")) invalid();
  for (const [index, choices] of Object.entries(def.enums || {}))
    if (words[index] !== undefined && !choices.includes(words[index])) invalid();
  return {name, args:words, opts};
}
export function errorInfo(error) {
  return {
    code: error.code || "COMMAND_FAILED",
    message: error.message,
    ...(error.candidates && {candidates: error.candidates}),
    ...(error.files && {files: error.files})
  };
}
export function createBroker({files, log}) {
  const pair = randomUUID(), pages = new Map(), jobs = new Map(), expired = new Set();
  let serial = 0, waiting = 0;
  const active = p => p.online && Date.now() - p.seen < 45000;
  const describe = p => ({id: p.id, name: p.name, online: active(p), ...p.context});
  const done = (result, page = null) => ({version:1,protocolVersion:1,status:"committed",page,pageId:page,result});
  function validatePageName(name, current) {
    if (!name || /^p[0-9]+$/.test(name) || [...pages.values()].some(page => page !== current && page.name === name))
      throw failure("NAME_CONFLICT", "Page name is empty, reserved or already in use");
  }
  function pageFor(key) {
    const live = [...pages.values()].filter(active);
    const page = key ? live.find(p => p.id === key || p.name === key) : live.length === 1 && live[0];
    if (!page)
      throw failure(
          key             ? "PAGE_UNAVAILABLE" :
              live.length ? "PAGE_REQUIRED" :
                            "PAGE_NOT_CONNECTED",
          "Choose a connected page", {candidates: live.map(p => p.id)});
    return page;
  }
  function nextJob(page, lane) {
    for (const job of jobs.values()) {
      if (job.page === page && !job.finished && (!lane || Boolean(job.interrupt) === (lane === "cancel"))) return job;
    }
  }
  function notifyPage(page) {
    for (const wake of page.waiters?.values() || []) wake();
  }
  function waitForWork(page, lane, ms) {
    page.waiters ??= new Map();
    if (!ms || page.waiters.has(lane) || waiting >= 16) return;
    return new Promise(resolve => {
      waiting++;
      const timer = setTimeout(wake,ms);
      function wake() { clearTimeout(timer); page.waiters.delete(lane); waiting--; resolve(); }
      page.waiters.set(lane,wake);
    });
  }
  function disconnect(p) {
    notifyPage(p);
    p.online = false;
    p.handles?.clear();
    p.paths?.clear();
    for (const job of jobs.values()) {
      if (job.page !== p || job.finished || job.phase === "writing")
        continue;
      finish(
          job, job.phase === "executing" ? "unknown" : "cancelled", null,
          {code: "PAGE_UNAVAILABLE", message: "Page disconnected"});
    }
  }
  function finish(j, status, result, error, context = j.page.context) {
    j.phase = status;
    notifyPage(j.page);
    j.finished = true;
    j.result = result;
    j.error = error;
    j.payload = null;
    j.documentVersion = context?.documentVersion ?? j.documentVersion;
    j.at = Date.now();
  }
  function pageContext(context, previous) {
    if (previous?.documentVersion > context.documentVersion) return previous;
    const {source,mode,documentVersion,moduleName,occurrence,pair,graphId,activeSide,documentId} = context;
    return {source,mode,documentVersion,moduleName,occurrence,pair,graphId,activeSide,documentId,
      pickerState:["open","selected","busy"].includes(context.pickerState) ? context.pickerState : "closed"};
  }
  function checkDocument(job, context) {
    if (!context?.documentVersion || !job.documentVersion || context.documentVersion === job.documentVersion)
      return true;
    const name = job.payload.name;
    if (["design info", "module list", "search find", "timing show"].includes(name))
      return true;
    const error = failure("STALE_DOCUMENT", "Target document changed before execution");
    log.error("workbench.stale_document", error, failureScope(job,name,error));
    finish(job, "failed", null, errorInfo(error), job.scope);
    return false;
  }
  function receipt(j) {
    return {
      version: 1,
      protocolVersion: 1,
      requestId: j.id,
      page: j.page?.id ?? null,
      pageId: j.page?.id ?? null,
      side: j.side || null,
      documentVersion: j.documentVersion,
      status: j.phase,
      ...(j.error ? {error: j.error} : {result: j.result ?? null})
    };
  }
  function prune() {
    for (const [id, j] of jobs)
      if (j.finished && Date.now() - j.at > 600000) {
        jobs.delete(id);
        expired.add(id);
      }
    while (expired.size > 4096) expired.delete(expired.values().next().value);
  }
  function lookup(id) {
    prune();
    if (expired.has(id))
      throw failure("REQUEST_EXPIRED", "The receipt retention period has ended");
    const job = jobs.get(id);
    if (!job)
      throw failure("UNKNOWN_REQUEST", "Unknown request");
    return job;
  }
  function fileHandle(p, path) {
    const previous = p.paths.get(path);
    if (previous)
      return previous;
    if (p.handles.size >= 4096) {
      const first = p.handles.keys().next().value;
      p.paths.delete(p.handles.get(first));
      p.handles.delete(first);
    }
    const id = "ngb-file:" + randomUUID();
    p.handles.set(id, path);
    p.paths.set(path, id);
    return id;
  }
  function sourcePath(arg, page, cwd) {
    if (!arg.startsWith("ngb-file:"))
      return resolve(cwd, arg);
    const path = page?.handles.get(arg);
    if (!path)
      throw failure("ACCESS_DENIED", "File selection belongs to another page or expired");
    return path;
  }
  function failureScope(job, operation, error) {
    const scope = {requestId:job.id, page:job.page.id, operation, code:error.code || "COMMAND_FAILED"};
    if (job.side) scope.side = job.side;
    for (const field of ["documentId","graphId","documentVersion"]) {
      if (job.scope?.[field] != null) scope[field] = job.scope[field];
    }
    return scope;
  }
  async function prepareInputs({name, args, opts}, page, cwd, job) {
    const inputs = [];
    let bytes = 0;
    for (const [index, arg] of args.entries()) {
      if (job.finished)
        break;
      let fileName = basename(arg);
      try {
        const path = opts.text === undefined ? sourcePath(arg, page, cwd) : arg;
        fileName = basename(path);
        const file =
            opts.text === undefined ? await files.read(path, Boolean(page)) : {name: arg, text: opts.text};
        bytes += Buffer.byteLength(file.text);
        if (bytes > 24 * 1024 * 1024)
          throw failure("FILE_LIMIT", "Input batch too large");
        inputs.push(file);
      } catch (error) {
        if (name === "files import" && error.code !== "ACCESS_DENIED" && error.code !== "FILE_LIMIT") {
          log.error(
              "workbench.read_failed", error,
              {...failureScope(job,name,error),fileName});
          inputs.push({name: fileName, error: errorInfo(error)});
          continue;
        }
        if (name === "aig add" || name === "design add" && job.page.context.mode === "AIG") {
          error.files = args.map((a, i) => ({
                                   name: i === index ? fileName : basename(page?.handles.get(a) || a),
                                   status: i === index ? "failed" : "uncommitted"
                                 }));
        }
        throw error;
      }
    }
    return inputs;
  }
  function commandSide(row, args, opts) {
    return row.sideArgument === undefined ? opts.side : args[row.sideArgument];
  }
  function payload(id, name, args, opts, inputs) {
    const options = {...opts};
    delete options.text;
    const row = definitions.get(name);
    return {id, name, args, side:commandSide(row,args,opts), opts:options, files:inputs, output:!!row.output, modes:row.modes};
  }
  function changePage(name, args, opts) {
    if (name === "page rename") {
      const page = pageFor(args[0]);
      validatePageName(args[1], page);
      page.name = args[1];
      notifyPage(page);
      return done(describe(page), page.id);
    }
    if (pages.size >= 2048)
      throw failure("PAGE_LIMIT", "Page limit reached");
    if (opts.name !== undefined) validatePageName(opts.name);
    const page = {id:"p"+ ++serial,name:opts.name || "",resume:randomUUID(),context:{},online:false};
    pages.set(page.id, page);
    return done({id: page.id, href: "/#ngb=" + pair + "&page=" + page.id + "&resume=" + page.resume}, page.id);
  }
  function pageMutation(name, args, opts) {
    const id = opts["request-id"];
    if (!id) return changePage(name, args, opts);
    // Match the original selector even if a successful rename has since changed it.
    const key = createHash("sha256").update(JSON.stringify([name, args, opts.name ?? null])).digest("hex");
    prune();
    if (expired.has(id) || jobs.has(id)) {
      const previous = lookup(id);
      if (previous.key !== key)
        throw failure("REQUEST_CONFLICT", "Request ID already used with different arguments");
      return receipt(previous);
    }
    if (jobs.size >= 2048) throw failure("QUEUE_FULL", "Workbench queue is full");
    const job = {id, key, phase:"committed", documentVersion:0, finished:true, at:Date.now()};
    try {
      const changed = changePage(name, args, opts);
      job.page = pages.get(changed.page);
      job.documentVersion = job.page.context.documentVersion ?? 0;
      job.result = changed.result;
    } catch (error) {
      job.phase = "failed";
      job.error = errorInfo(error);
      log.error("workbench.page_failed", error, {operation:name, code:job.error.code, requestId:id});
    }
    jobs.set(id, job);
    return receipt(job);
  }
  async function command(b, browserPage) {
    const {name, args, opts} = parseCommand(b.argv);
    const cwd = browserPage ? files.roots[0] : resolve(b.cwd || ".");
    if (name === "commands" && opts.available) {
      const key = opts.page || b.page;
      let page;
      try {
        if (key || opts.side || [...pages.values()].some(active)) page = pageFor(key);
        if (opts.side && page?.context.mode !== "Compare")
          throw failure("INVALID_SIDE", "Only a Compare page has sides A and B");
      } catch (error) {
        log.error("workbench.catalogue_failed", error, {operation:name, code:error.code,
          requestId:opts["request-id"] || b.id, page:page?.id || key, side:opts.side});
        throw error;
      }
      const mode = page?.context.mode;
      return done(catalogue.commands.filter(row => {
        if (row.capability !== "v1") return false;
        if (row.target !== "page") return !opts.side;
        if (!page || row.modes && !row.modes.includes(mode)) return false;
        if (opts.side ? !row.compareSide : mode === "Compare" && row.compareSide === "required") return false;
        return !row.pickerStates || row.pickerStates.includes(page.context.pickerState || "closed");
      }), page?.id);
    }
    if (name === "commands" || name === "help")
      return done(catalogue.commands.filter(d => !args.length || d.name.startsWith(args.join(" "))));
    if (["start", "stop", "status", "cmd", "quit"].includes(name))
      throw failure("INVALID_ARGUMENT", "Use this command at the launcher or prompt");
    if (name === "page list")
      return done([...pages.values()].filter(active).map(describe));
    if (name === "page new" || name === "page rename")
      return pageMutation(name, args, opts);
    if (name.startsWith("page ")) {
      if (name === "page wait") {
        const known = pages.get(args[0]) || [...pages.values()].find(page => page.name === args[0]);
        if (known && !active(known))
          return {version:1,protocolVersion:1,status:"waiting",page:known.id,pageId:known.id};
      }
      const p = pageFor(args[0]);
      return done(describe(p), p.id);
    }
    if (name.startsWith("job ")) {
      const j = lookup(args[0]);
      if (name === "job cancel" && !j.finished) {
        if (["executing", "writing"].includes(j.phase))
          throw failure("ALREADY_EXECUTING", "Page has begun applying this command");
        finish(j, "cancelled", null, {code: "CANCELLED", message: "Cancelled before execution"});
      }
      return receipt(j);
    }
    if (name === "fs roots")
      return done(files.roots);
    if (name === "fs pwd")
      return done({path: cwd});
    if (name.startsWith("fs ")) {
      const path = resolve(cwd, args[0] || ".");
      if (name === "fs cd")
        return done({path: (await files.list(path, "", 1, !!browserPage)).path});
      if (name === "fs complete") {
        const endsInDirectory = /[\\/]$/.test(args[0]) || args[0] === "";
        return done(await files.list(
            endsInDirectory ? path : dirname(path), endsInDirectory ? "" : basename(path), 1, !!browserPage,
            true));
      }
      return done(await files.list(path, opts.filter || "", Number(opts["page-number"] || 1), !!browserPage));
    }
    const id = opts["request-id"] || b.id || randomUUID();
    prune();
    if (expired.has(id))
      throw failure("REQUEST_EXPIRED", "The receipt retention period has ended");
    const previous = jobs.get(id);
    const selector = browserPage?.id || opts.page || b.page || "";
    // A retry refers to the originally resolved page, even after it goes offline or is renamed.
    if (previous && (!previous.page || (selector !== previous.selector && selector !== previous.page.id &&
        (!selector || selector !== previous.page.name))))
      throw failure("REQUEST_CONFLICT", "Request ID already used for another target");
    const p = previous?.page || browserPage || pageFor(selector);
    const semanticOptions =
        Object.entries(opts)
            .filter(([key]) => !["request-id", "timeout", "async", "json", "page"].includes(key))
            .sort(([a], [b]) => a.localeCompare(b));
    const fingerprint =
        createHash("sha256").update(JSON.stringify([p.id, cwd, name, args, semanticOptions])).digest("hex");
    if (previous) {
      if (previous.key !== fingerprint)
        throw failure("REQUEST_CONFLICT", "Request ID already used with different arguments");
      return receipt(previous);
    }
    if (jobs.size >= 2048 || [...jobs.values()].filter(j => !j.finished).length >= 64)
      throw failure("QUEUE_FULL", "Workbench queue is full");
    const j = {
      id,
      key: fingerprint,
      page: p,
      selector,
      scope:p.context,
      side: commandSide(definitions.get(name),args,opts),
      interrupt:definitions.get(name).interrupt,
      phase: "reading",
      at: Date.now(),
      documentVersion: p.context.documentVersion || 0
    };
    jobs.set(id, j);
    async function prepare() {
      try {
        const inputs =
            inputCommands.has(name) ? await prepareInputs({name, args:args.slice(definitions.get(name).inputStart), opts}, browserPage, cwd, j) : [];
        if (j.finished)
          return;
        if (definitions.get(name).output && (opts.out || !opts.download && args[0] !== "download")) {
          if (browserPage)
            throw failure("ACCESS_DENIED", "Use the terminal to write server output");
          j.output = resolve(cwd, args[0]);
          j.overwrite = !!opts.overwrite;
        }
        j.payload = payload(id, name, args, opts, inputs);
        j.phase = "queued";
        notifyPage(p);
      } catch (error) {
        if (j.finished)
          return;
        log.error("workbench.prepare_failed", error, failureScope(j,name,error));
        finish(j, "failed", null, errorInfo(error));
      }
    }
    if (opts.async)
      void prepare();
    else
      await prepare();
    return receipt(j);
  }
  async function handle(b, admin) {
    if (b.version !== 1)
      throw failure("PROTOCOL_VERSION", "Expected protocol version 1");
    if (admin) {
      if (b.op === "command") {
        const response = await command(b);
        return {requestId: b.id || randomUUID(), side: null, documentVersion: 0, ...response};
      }
      if (b.op === "status")
        return receipt(lookup(b.id));
      throw failure("INVALID_ARGUMENT", "Unknown control operation");
    }
    if (b.op === "join") {
      if (b.token !== pair)
        throw failure("ACCESS_DENIED", "Pair this browser");
      let p = pages.get(b.page);
      if (!p || p.resume !== b.resume || (active(p) && !b.reload)) {
        if (pages.size >= 2048)
          throw failure("PAGE_LIMIT", "Page limit reached");
        p = {id: "p" + ++serial, resume: randomUUID(), name: "", context: {}};
        pages.set(p.id, p);
      } else
        disconnect(p);
      Object.assign(
          p,
          {online: true, context:{}, connection: randomUUID(), seen: Date.now(), handles: new Map(), paths: new Map()});
      return {page:p.id, connection:p.connection, resume:p.resume, cancelLane:true};
    }
    const p = pages.get(b.page);
    if (!p || !p.online || p.connection !== b.connection)
      throw failure("PAGE_UNAVAILABLE", "Page connection expired");
    p.seen = Date.now();
    if (b.op === "leave") {
      disconnect(p);
      return {};
    }
    if (b.op === "pulse")
      return {};
    if (b.op === "list") {
      const list = await files.list(b.path, b.filter || "", Number(b.number ?? 1));
      if (!p.online || p.connection !== b.connection)
        throw failure("PAGE_UNAVAILABLE","Page connection expired");
      for (const e of list.entries)
        if (!e.directory)
          e.handle = fileHandle(p, resolve(list.path, e.name));
      return list;
    }
    if (b.op === "import") {
      if (!inputCommands.has(b.argv?.slice(0, 2).join(" ")))
        throw failure("ACCESS_DENIED", "Invalid picker action");
      const target = parseCommand(b.argv).opts.page;
      if (target && target !== p.id)
        throw failure("ACCESS_DENIED", "Invalid file picker target");
      return command(b, p);
    }
    if (b.op === "poll") {
      if (b.context) p.context = pageContext(b.context, p.context);
      const lane = b.lane || "";
      if (!["","work","cancel"].includes(lane)) throw failure("INVALID_ARGUMENT","Invalid poll lane");
      let j = nextJob(p,lane);
      if (!j || j.phase === "reading") {
        const waitMs = Math.min(8000,Math.max(0,Number(b.waitMs) || 0));
        if (waitMs) {
          await waitForWork(p,lane,waitMs);
          if (!p.online || p.connection !== b.connection) throw failure("PAGE_UNAVAILABLE","Page connection expired");
          j = nextJob(p,lane);
        }
      }
      if (!j || !["queued","delivered"].includes(j.phase) || !checkDocument(j,p.context)) return {name:p.name};
      j.phase = "delivered";
      return {job:{...j.payload,files:[],hasInputs:j.payload.files.length > 0},name:p.name};
    }
    const j = lookup(b.id);
    if (j.page !== p)
      throw failure("ACCESS_DENIED", "Job belongs to another page");
    if (b.op === "status")
      return receipt(j);
    if (b.op === "inputs") {
      if (!["delivered","executing"].includes(j.phase)) throw failure("INVALID_STATE","Input delivery no longer active");
      return {files:j.payload.files};
    }
    if (b.op === "picker-files") {
      if (j.phase !== "executing" || j.payload.name !== "files submit")
        throw failure("INVALID_STATE", "No active picker submission");
      const c = parseCommand(b.argv);
      if (!inputCommands.has(c.name) || c.opts.text !== undefined || c.opts.page && c.opts.page !== p.id)
        throw failure("ACCESS_DENIED", "Invalid file picker action");
      const inputs = await prepareInputs(c, p, files.roots[0], j);
      return payload(j.id, c.name, c.args, c.opts, inputs);
    }
    if (b.op === "grant") {
      if (j.phase === "executing")
        return {granted: true};
      if (b.context)
        p.context = pageContext(b.context, p.context);
      if (j.phase !== "delivered" || !checkDocument(j, p.context))
        return {granted: false};
      j.phase = "executing";
      return {granted: true};
    }
    if (b.op === "ack" && j.finished)
      return receipt(j);
    if (b.op === "ack" && j.phase === "writing")
      return j.write;
    if (b.op === "ack" && j.phase === "executing") {
      if (b.context)
        p.context = pageContext(b.context, p.context);
      const context = p.context;
      if (!b.error && j.output) {
        j.phase = "writing";
        j.write = (async () => {
          try {
            const result = await files.output(j.output, b.result.text, j.overwrite);
            finish(j, "committed", result, null, context);
          } catch (error) {
            log.error("workbench.export_failed", error, failureScope(j,j.payload.name,error));
            finish(j, "failed", null, errorInfo(error), context);
          }
          return receipt(j);
        })();
        try { return await j.write; }
        finally { delete j.write; }
      }
      finish(j, b.error ? (b.error.code === "CANCELLED" ? "cancelled" : "failed") : b.result?.partial ? "partial" : "committed", b.result, b.error, context);
      return receipt(j);
    }
    throw failure("INVALID_STATE", "Unexpected page operation");
  }
  const sweep = setInterval(() => {
    for (const p of pages.values())
      if (p.online && !active(p))
        disconnect(p);
  }, 5000);
  sweep.unref();
  return {pair,handle,close() {
    clearInterval(sweep);
    for (const page of pages.values()) if (page.online) disconnect(page);
  }};
}
