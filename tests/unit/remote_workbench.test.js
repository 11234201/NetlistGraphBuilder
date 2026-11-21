import test from "node:test";
import assert from "node:assert/strict";
import {readFile, mkdtemp, writeFile, readdir, rm, stat, mkdir, symlink, open, utimes} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createBroker, catalogue, parseCommand} from "../../tools/workbench_broker.mjs";
import {createWorkbenchFiles} from "../../tools/workbench_files.mjs";
import {makeLauncherState, prepareLauncherState, writeLauncherState} from "../../tools/launcher-state.mjs";
import {createAigCollection} from "../../src/app/aig_collection.js";
import {createAigCollectionStorage} from "../../src/persistence/aig_collection_storage.js";

test("R02 starting a second service preserves a live session record during a control outage", async t => {
  const dir = await mkdtemp(join(tmpdir(), "ngb-state-test-"));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const path = join(dir, "session.json");
  const state = makeLauncherState({stateFile:path, port:4173, url:"http://127.0.0.1:4173/"});
  state.control = join(dir, "temporarily-unavailable");
  await writeLauncherState(state);
  await assert.rejects(prepareLauncherState(path, false), /live process/);
  await assert.rejects(writeLauncherState({...state, owner:"second-service"}), {code:"EEXIST"});
  assert.deepEqual(JSON.parse(await readFile(path,"utf8")), state);
});

test("an outstanding directory listing cannot issue file handles after its page reconnects", async t => {
  let complete;
  const listing = new Promise(resolve => { complete = resolve; });
  const broker = createBroker({files:{roots:["/tmp"], list:() => listing},log:{error(){}}});
  t.after(broker.close);
  const join = fields => broker.handle({version:1,op:"join",token:broker.pair,...fields},false);
  const first = await join();
  const send = (identity, op) => broker.handle({version:1,...identity,op,path:"/tmp"},false);
  const pending = send(first,"list");
  await send(first,"leave");
  const fresh = await join({page:first.page,resume:first.resume});
  const result = {path:"/tmp",entries:[{name:"source.v",directory:false}]};
  complete(result);
  await assert.rejects(pending,{code:"PAGE_UNAVAILABLE"});
  assert.equal(result.entries[0].handle,undefined);
  assert.match((await send(fresh,"list")).entries[0].handle,/^ngb-file:/);
});

test("R13 duplicate acknowledgements share the export failure and preserve a newer page context", async t => {
  let rejectWrite;
  const output = new Promise((_,reject) => { rejectWrite = reject; });
  const logs = [];
  const broker = createBroker({files:{roots:["/tmp"], output:() => output},log:{error:(...args) => logs.push(args)}});
  t.after(broker.close);
  const page = await broker.handle({version:1,op:"join",token:broker.pair}, false);
  const send = (op,fields = {}) => broker.handle({version:1,op,...page,...fields}, false);
  const run = argv => broker.handle({version:1,op:"command",argv,page:page.page}, true);
  await send("poll", {context:{documentVersion:1}});
  const {requestId:id} = await run(["svg","export","top.svg"]);
  await send("poll");
  await send("grant",{id});
  const first = send("ack",{id,result:{text:"<svg/>"},context:{documentVersion:1}});
  const second = send("ack",{id,result:{text:"<svg/>"}});
  await send("poll", {context:{documentVersion:2}});
  const error = Object.assign(new Error("Test output write failed"), {code:"EIO"});
  rejectWrite(error);
  const [one,two] = await Promise.all([first,second]);
  assert.deepEqual(one,two);
  assert.equal(one.status,"failed");
  assert.equal(one.error.code,"EIO");
  assert.equal(one.documentVersion,1);
  assert.equal((await run(["page","info",page.page])).result.documentVersion,2);
  assert.equal(logs.length,1);
  assert.equal(logs[0][1],error);
  assert.equal(logs[0][2].requestId,id);
});
test("R04 idle poll wakes on enqueue and large inputs stay bound to the receiving connection", async t => {
  const text = "private-source-text";
  const broker = createBroker({files:{roots:["/tmp"],read:async () => ({name:"top.v",text})},log:{error(){}}});
  t.after(broker.close);
  const run = (op, args, admin = false) => broker.handle({version:1,op,...args},admin);
  const page = await run("join",{token:broker.pair});
  const other = await run("join",{token:broker.pair});
  const polling = run("poll",{...page,waitMs:5000});
  await run("command",{id:"separate",argv:["open","top.v"],page:page.page},true);
  const {job} = await polling;
  assert.equal(job.id,"separate");
  assert.equal(job.hasInputs,true);
  assert.ok(!JSON.stringify(job).includes(text));
  await assert.rejects(run("inputs",{...other,id:job.id}),{code:"ACCESS_DENIED"});
  assert.equal((await run("inputs",{...page,id:job.id})).files[0].text,text);
  await run("command",{argv:["job","cancel",job.id]},true);
  await assert.rejects(run("inputs",{...page,id:job.id}),{code:"INVALID_STATE"});
});


test("R01 published grammar matches the eight command groups and five aliases", async () => {
  const plan =
      await readFile(new URL("../../docs/plans/remote_workbench_commands.md", import.meta.url), "utf8");
  const groups = plan.split(/^### 3\.\d+ .*$/m).slice(1, 9).map(section => {
    const block = section.match(/^```text\r?\n([\s\S]*?)^```/m)[1];
    return block.split(/\r?\n/)
        .map(line => line.trim().split(/\s{2,}/)[0])
        .filter(line => /^[a-z]/.test(line));
  });
  assert.deepEqual(groups.map(g => g.length), [16, 25, 34, 33, 15, 24, 7, 26]);
  assert.deepEqual(catalogue.commands.map(c => c.syntax), groups.flat());
  assert.equal(new Set(catalogue.commands.map(c => c.name)).size, 180);
  assert.deepEqual(catalogue.aliases, {
    pages: "page list",
    use: "page use",
    open: "design open",
    add: "design add",
    "add-timing": "timing add"
  });
  assert.ok(catalogue.commands.every(c => c.target && c.capability && c.completion));
  assert.throws(() => parseCommand(["aig", "open", "a", "b"]), {code: "INVALID_ARGUMENT"});
});

test("R03/R04 cancellation at file read, delivery and grant; scoped receipts and deduplication", async t => {
  let unblock, reads = 0;
  const gate = new Promise(r => {
    unblock = r;
  });
  const broker = createBroker({
    files: {
      roots: ["/tmp"],
      async read() {
        reads++;
        await gate;
        return {name: "a", text: "abc"};
      }
    },
    log: {error() {}}
  });
  t.after(broker.close);
  const admin = (op, fields = {}) => broker.handle({version: 1, op, ...fields}, true);
  const page = (op, p, fields = {}) => broker.handle({version: 1, op, ...p, ...fields}, false);
  const p = await page("join", {}, {token: broker.pair});
  const command = (id, ...argv) => admin("command", {id, argv, page: p.page, cwd: "/tmp"});
  await assert.rejects(command("name","page","rename",p.page,"p2"), {code:"NAME_CONFLICT"});
  await command("reserve","page","new","--name","eco");
  await assert.rejects(command("duplicate","page","new","--name","eco"), {code:"NAME_CONFLICT"});
  await assert.rejects(
      broker.handle({version: 2, op: "command", argv: ["open", "a"]}, true), {code: "PROTOCOL_VERSION"});
  await assert.rejects(command("bad", "open"), {code: "INVALID_ARGUMENT"});
  assert.equal(reads, 0);
  const reading = command("read", "open", "a");
  assert.equal((await admin("status", {id: "read"})).status, "reading");
  assert.equal((await command("c", "job", "cancel", "read")).status, "cancelled");
  unblock();
  assert.equal((await reading).status, "cancelled");
  await command("prep", "module", "list");
  const polled = await page("poll", p);
  assert.equal(polled.job.id, "prep");
  assert.equal((await command("c", "job", "cancel", "prep")).status, "cancelled");
  assert.equal((await page("grant", p, {id: "prep"})).granted, false);
  await command("exec", "module", "list");
  await page("poll", p);
  await page("grant", p, {id: "exec"});
  await page("ack", p, {id: "exec", result: ["top"]});
  assert.deepEqual((await command("exec", "module", "list")).result, ["top"]);
  await assert.rejects(command("exec", "module", "open", "different"), {code: "REQUEST_CONFLICT"});
  const clone = await page("join", {}, {token: broker.pair, page: p.page, resume: p.resume, reload: false});
  assert.notEqual(clone.page, p.page);
  await assert.rejects(page("status", clone, {id: "exec"}), {code: "ACCESS_DENIED"});
  await command("unknown", "module", "list");
  await page("poll", p);
  await page("grant", p, {id: "unknown"});
  await page("leave", p);
  assert.equal((await admin("status", {id: "unknown"})).status, "unknown");
  const again = await page("join", {}, {token: broker.pair, page: p.page, resume: p.resume, reload: true});
  assert.equal(again.page, p.page);
  assert.equal((await page("poll", again)).job, undefined);
  assert.equal((await page("poll", clone)).job, undefined);
});

test(
    "R08/R09 add validates before creating entries and preserves active graph if activation fails",
    async () => {
      const source = name => ({name, text: name});
      let layouts = 0, collection, fail = false;
      collection = createAigCollection({
        validate(file) {
          if (file.name === "bad")
            throw new Error("broken");
        },
        render() {},
        async activate(file, view) {
          layouts++;
          if (fail)
            throw new Error("Layout failed");
          collection.commit(file, view?.graphId);
        }
      });
      const request = {signal: new AbortController().signal};
      await collection.add([source("same")], request);
      const initial = layouts;
      await collection.add([source("same")], request);
      assert.equal(layouts - initial, 0);
      await assert.rejects(
          collection.add([source("more"), source("bad")], request),
          e => e.files[0].status === "uncommitted" && e.files[1].status === "failed");
      await assert.rejects(collection.switchTo("same", request), {code: "AMBIGUOUS_GRAPH"});
      fail = true;
      await assert.rejects(collection.switchTo("g2", request));
      assert.equal(collection.list().find(g => g.active).id, "g1");
      fail = false;
      await collection.switchTo("g2", request);
      assert.equal(collection.list().find(g => g.active).id, "g2");
    });

test(
    "R10 both old versions restore, unchanged sources are written zero times on pan and quota clears obsolete archive",
    () => {
      const writes = [];
      let quota = false;
      const storage = {
        getItem(k) {
          return this[k] || null;
        },
        setItem(k, v) {
          if (quota)
            throw Error("quota");
          writes.push(k);
          this[k] = v;
        },
        removeItem(k) {
          delete this[k];
        }
      };
      const archive = createAigCollectionStorage(() => storage);
      for (const version of [1, 2]) {
        storage.setItem("ngb.domain-workspace.v1", JSON.stringify({
          kind: "domain-workspace",
          version,
          normalizationVersion: 1,
          domainId: "aig",
          source: {name: "legacy", text: "legacy"}
        }));
        assert.equal(archive.load().entries.length, 1);
      }
      const collection = createAigCollection({render() {}, activate() {}, validate() {}});
      collection.commit({name: "base", text: "one"});
      const request = {signal: new AbortController().signal};
      return collection.add([{name: "eco", text: "two"}], request).then(() => {
        collection.save({selectedId: "n0"}, archive);
        writes.length = 0;
        collection.save({selectedId: "n0", viewport: {scale: 2}}, archive);
        assert.equal(writes.filter(k => k.startsWith("ngb.aig-source.")).length, 0);
        assert.equal(archive.load().entries.length, 2);
        quota = true;
        assert.throws(() => collection.save({}, archive), /quota/);
        assert.equal(archive.load(), null);
        assert.equal(collection.list().length, 2);
      });
    });

test("R05 file import detects truncation and same-size regeneration between real reads", async t => {
  const dir = await mkdtemp(join(tmpdir(), "ngb-changing-input-"));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const path = join(dir, "changing.v");
  const probe = await open(path, "w");
  const handleType = Object.getPrototypeOf(probe);
  await probe.close();
  const read = handleType.read;
  let regenerate;
  t.mock.method(handleType, "read", async function(buffer, offset, length, ...rest) {
    if (!regenerate) return read.call(this, buffer, offset, length, ...rest);
    const mutate = regenerate;
    regenerate = undefined;
    const part = await read.call(this, buffer, offset, Math.min(length, 3), ...rest);
    await mutate();
    return part;
  });
  const files = await createWorkbenchFiles([dir], () => false);
  const errors = [];
  const broker = createBroker({files, log: {error: (...fields) => errors.push(fields)}});
  t.after(broker.close);
  const page = await broker.handle({version:1, op:"join", token:broker.pair}, false);
  for (const [id, replacement] of [["truncate", "x"], ["rewrite", "new-text"]]) {
    await writeFile(path, "original");
    await utimes(path, new Date(0), new Date(0));
    regenerate = () => writeFile(path, replacement);
    const receipt = await broker.handle({version:1, op:"command", id, argv:["design","open",path]}, true);
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.error.code, "FILE_CHANGED");
    assert.equal((await broker.handle({version:1, op:"poll", ...page}, false)).job, undefined);
    const scope = errors.filter(([, , details]) => details.requestId === id);
    assert.equal(scope.length, 1);
    assert.equal(scope[0][1].code, "FILE_CHANGED");
    assert.deepEqual(scope[0][2], {requestId:id, page:page.page, operation:"design open",code:"FILE_CHANGED"});
    assert.equal((await files.read(path, true)).text, replacement);
  }
  await writeFile(path, "");
  assert.equal((await files.read(path, true)).text, "");
});

test("R11/R13 bounded listing, root and private-file checks, safe server export", async t => {
  const dir = await mkdtemp(join(tmpdir(), "ngb-files-"));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const roots = [join(dir, "one"), join(dir, "two")];
  await Promise.all(roots.map(p => mkdir(p)));
  const hidden = join(roots[0], "state");
  await writeFile(hidden, "private");
  const files = await createWorkbenchFiles(roots, p => p === hidden);
  await Promise.all(Array.from({length: 103}, (_, i) => writeFile(join(roots[1], "match-" + i), "data")));
  const page = await files.list(roots[1], "match", 2);
  assert.equal(page.entries.length, 3);
  assert.equal(page.total, 103);
  assert.deepEqual((await files.list(roots[0], "", 1)).entries, []);
  await assert.rejects(files.read(hidden, true), {code: "ACCESS_DENIED"});
  await assert.rejects(files.list(dir, "", 1), {code: "ACCESS_DENIED"});
  if (process.platform !== "win32") {
    await symlink(dir, join(roots[0], "outside"));
    await assert.rejects(
        files.read(join(roots[0], "outside", "one", "state"), true), {code: "ACCESS_DENIED"});
  }
  const target = join(roots[0], "out.svg");
  await files.output(target, "<svg/>", false);
  await assert.rejects(files.output(target, "other", false), {code: "EEXIST"});
  await assert.rejects(files.output(target, {}, true));
  assert.equal(await readFile(target, "utf8"), "<svg/>");
  assert.equal((await readdir(roots[0])).filter(n => n.startsWith(".ngb-export-")).length, 0);
  await files.output(target, "<svg id='new'/>", true);
  assert.ok((await stat(target)).size > 6);
});
