import assert from "node:assert/strict";
import test from "node:test";
import {posix,win32} from "node:path";
import {createServerFilePicker} from "../../src/ui/server_file_picker.js";
import {createRemoteFileImport} from "../../src/app/remote_file_import.js";
import {createImportRequests} from "../../src/application/import_requests.js";
import {makePickerDocument, descendants, eventOf, settle, deferred, fakeClock} from "../helpers/server_picker_dom.js";

for (const [name,fs,roots,file] of [
  ["drive",win32,["C:\\project","D:\\designs"],"input.v"],
  ["network share",win32,["\\\\server\\public","\\\\server\\designs"],"input.v"],
  ["POSIX backslash in file name",posix,["/project","/designs"],"input\\example.v"]
]) test("server picker uses host paths and submits the listed handle for "+name, async t => {
  const {document,controls} = makePickerDocument();
  const root = roots[1], child = fs.join(root,"sub");
  let selected, lists = 0;
  const picker = createServerFilePicker({document,context:() => ({mode:"Single",documentVersion:1}),
    list:async value => {
      lists++;
      return {path:fs.normalize(value),number:1,total:1,roots,entries:[{name:file,handle:"ngb-file:visible"}]};
    },
    submit:async (action,values) => { selected = values; return {partial:false}; },report:assert.fail});
  await picker.open("design open",child);
  assert.equal(controls.get("[data-roots]").value,root);
  picker.choose([fs.join(child,file)]);
  assert.equal(lists,1);
  assert.equal(descendants(controls.get("[data-entries]")).find(node => node.type === "checkbox").checked,true);
  await picker.apply();
  assert.deepEqual(selected,["ngb-file:visible"]);
  await picker.open("design open",child);
  await controls.get("[data-up]").onclick(eventOf("click"));
  await settle();
  assert.equal(fs.normalize(controls.get("[data-path]").value),fs.normalize(root));
  assert.equal(controls.get("[data-up]").disabled,true);
});

function harness(t, options = {}) {
  const dom = makePickerDocument(), clock = fakeClock(), calls = [], submissions = [], reports = [];
  let current = {mode:"Single", page:"p1", documentId:"document:1", documentVersion:1, ...options.current};
  const picker = createServerFilePicker({
    document:dom.document, timers:clock, context:() => current,
    list:async (path, filter, number) => {
      calls.push({path, filter, number});
      return options.list ? options.list(path, filter, number) : directory(path || "/work", [file("one.v")], number);
    },
    submit:async (...args) => {
      submissions.push(args);
      return options.submit ? options.submit(...args) : {partial:false};
    },
    report:(error, details) => { reports.push({error, details}); options.report?.(error, details); }
  });
  return {...dom, picker, clock, calls, submissions, reports,
    dialog:dom.document.body.children[0], setContext:value => { current = {...current, ...value}; }};
}
const file = name => ({name, handle:"ngb-file:" + name});
const directory = (path, entries = [], number = 1, total = entries.length, roots = ["/work"]) =>
  ({path, roots, entries, number, total});
function checked(h, value) {
  return descendants(h.control("entries")).find(node => node.type === "checkbox" && node.value === value);
}
async function go(h, path) {
  h.control("path").value = path;
  await h.control("go").onclick(eventOf("click"));
  await settle();
}

test("selections survive paging and navigation, and visible removal and clear update the submitted set", async t => {
  const h = harness(t, {list:(path, _filter, number) => directory(path || "/work",
    [file(path === "/work/other" ? "third.v" : number === 2 ? "second.v" : "first.v")], number, path === "/work/other" ? 1 : 101)});
  await h.picker.open("files import");
  h.picker.choose(["first.v"]);
  await h.control("next").onclick(eventOf("click"));
  await settle();
  h.picker.choose(["second.v"]);
  await go(h, "/work/other");
  h.picker.choose(["third.v"]);
  assert.match(h.control("selection-count").textContent, /3/);
  await h.control("selection-toggle").onclick(eventOf("click"));
  assert.equal(h.control("selection-panel").hidden, false);
  const second = h.control("selected-list").children.find(row => row.textContent.includes("/work/second.v"));
  assert.ok(second, "cross-page selection is available for inspection");
  await second.querySelector("button").onclick(eventOf("click"));
  assert.match(h.control("selection-count").textContent, /2/);
  await go(h, "/work");
  assert.equal(checked(h, "/work/first.v").checked, true);
  await h.picker.apply();
  assert.deepEqual(h.submissions[0][1], ["ngb-file:first.v", "ngb-file:third.v"]);
  await h.picker.open("files import");
  h.picker.choose(["first.v"]);
  await h.control("selection-clear").onclick(eventOf("click"));
  assert.equal(h.picker.state(), "open");
  assert.equal(checked(h, "/work/first.v").checked, false);
  assert.equal(h.control("submit").disabled, true);
});

test("filter requests are debounced, immediately block submission, and preserve selected files", async t => {
  const h = harness(t);
  await h.picker.open("files import");
  h.picker.choose(["one.v"]);
  const previousRow = h.control("entries").children[0];
  h.control("filter").value = "o";
  h.control("filter").oninput(eventOf("input"));
  h.clock.tick(100);
  h.control("filter").value = "one";
  h.control("filter").oninput(eventOf("input"));
  assert.equal(h.control("submit").disabled, true);
  assert.equal(h.control("entries").children[0], previousRow, "keep the prior list while refreshing");
  assert.throws(() => h.picker.choose(["one.v"]), {code:"DIRECTORY_NOT_READY"});
  h.clock.tick(199);
  await settle();
  assert.equal(h.calls.length, 1);
  h.clock.tick(1);
  await settle();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1], {path:"/work", filter:"one", number:1});
  assert.equal(checked(h, "/work/one.v").checked, true);
  assert.equal(h.control("submit").disabled, false);
});

test("an older directory failure cannot overwrite the latest response or add a diagnostic", async t => {
  const old = deferred(), fresh = deferred();
  const h = harness(t, {list:path => path === "/work/old" ? old.promise : path === "/work/new" ? fresh.promise : directory("/work", [file("one.v")])});
  await h.picker.open("files import");
  h.control("path").value = "/work/old";
  const oldNavigation = h.control("go").onclick(eventOf("click"));
  h.control("path").value = "/work/new";
  const newNavigation = h.control("go").onclick(eventOf("click"));
  fresh.resolve(directory("/work/new", [file("new.v")]));
  await newNavigation;
  await settle();
  old.reject(Object.assign(new Error("old directory failed"), {code:"EACCES"}));
  await oldNavigation;
  await settle();
  assert.equal(h.control("path").value, "/work/new");
  assert.ok(checked(h, "/work/new/new.v"));
  assert.deepEqual(h.reports, []);
});

test("closing during a directory request ignores late failure and cancels pending filter work", async t => {
  const pending = deferred();
  const h = harness(t, {list:() => pending.promise});
  const opening = h.picker.open("files import");
  const rejected = assert.rejects(opening, {name:"AbortError"});
  h.picker.cancel();
  pending.reject(new Error("late disconnect"));
  await rejected;
  assert.equal(h.picker.state(), "closed");
  assert.deepEqual(h.reports, []);
  const second = harness(t);
  await second.picker.open("files import");
  second.control("filter").value = "pending";
  second.control("filter").oninput(eventOf("input"));
  second.picker.cancel();
  second.clock.tick(500);
  await settle();
  assert.equal(second.calls.length, 1);
});

test("directory failures preserve the original error and target context and recover through Retry", async t => {
  const original = Object.assign(new Error("directory denied", {cause:new Error("host denied access")}), {code:"EACCES"});
  let fail = true;
  const h = harness(t, {current:{graphId:"graph:old"},
    list:() => { if (fail) throw original; return directory("/work", []); }});
  await assert.rejects(h.picker.open("files import", "/work"), error => error === original);
  assert.equal(h.reports.length, 1);
  const {error, details} = h.reports[0];
  assert.equal(error, original);
  assert.equal(error.cause.message, "host denied access");
  assert.equal(details.operation, "files.list");
  assert.equal(details.code, "EACCES");
  assert.equal(details.documentId, "document:1");
  assert.equal(details.documentVersion, 1);
  assert.equal(details.graphId, "graph:old");
  assert.equal(details.page, "p1");
  assert.ok(details.requestId);
  assert.equal(h.control("submit").disabled, true);
  assert.equal(h.control("retry").hidden, false);
  fail = false;
  await h.control("retry").onclick(eventOf("click"));
  await settle();
  assert.equal(h.control("retry").hidden, true);
  assert.equal(h.picker.state(), "open");
  assert.equal(h.reports.length, 1, "an empty directory is a successful result");
});

test("a failed log sink cannot mask the original list or import failure", async t => {
  const listError = new Error("original read error");
  const first = harness(t, {list:() => { throw listError; }, report:() => { throw Error("sink unavailable"); }});
  await assert.rejects(first.picker.open("files import"), error => error === listError);
  const importError = new Error("original import error");
  const second = harness(t, {submit:() => { throw importError; }, report:() => { throw Error("sink unavailable"); }});
  await second.picker.open("files import");
  second.picker.choose(["one.v"]);
  await assert.rejects(second.picker.apply(), error => error === importError);
  assert.equal(second.reports.length, 1);
  assert.equal(second.reports[0].details.operation, "files.submit");
  assert.equal(second.reports[0].details.code, "IMPORT_FAILED");
  assert.equal(second.picker.state(), "selected");
});

test("partial success removes committed selections, retains file outcomes, and retries only remaining handles", async t => {
  let attempt = 0;
  const h = harness(t, {
    list:() => directory("/work", [file("good.v"), file("bad.v")]),
    submit:() => ++attempt === 1 ? {partial:true, mode:"Single", page:"p1", documentId:"document:1", documentVersion:1,
      files:[{name:"good.v", status:"committed"}, {name:"bad.v", status:"failed", error:{message:"invalid Verilog"}}]} : {partial:false}
  });
  await h.picker.open("files import");
  h.picker.choose(["good.v", "bad.v"]);
  const result = await h.picker.apply();
  assert.equal(result.partial, true);
  assert.equal(h.picker.state(), "selected");
  assert.equal(checked(h, "/work/good.v").checked, false);
  assert.equal(checked(h, "/work/bad.v").checked, true);
  assert.match(h.control("results").textContent, /good\.v/);
  assert.match(h.control("results").textContent, /invalid Verilog/);
  assert.match(h.control("selection-count").textContent, /1/);
  await h.picker.apply();
  assert.deepEqual(h.submissions.map(call => call[1]), [["ngb-file:good.v", "ngb-file:bad.v"], ["ngb-file:bad.v"]]);
  assert.deepEqual(h.reports, [], "partial file outcomes are already diagnosed by the import owner");
});

test("a partial import keeps its loaded directory and immediately releases cancellation", async t => {
  let reads = 0;
  const refreshError = Object.assign(new Error("directory disappeared"), {code:"ENOENT"});
  const partial = {partial:true, mode:"Single", page:"p1", documentVersion:1, documentId:"document:1",
    files:[{name:"good.v", status:"committed"}, {name:"bad.v", status:"failed", error:{message:"invalid Verilog"}}]};
  const h = harness(t, {list:() => {
    if (++reads > 1) throw refreshError;
    return directory("/work", [file("good.v"), file("bad.v")]);
  }, submit:() => partial});
  await h.picker.open("files import");
  h.picker.choose(["good.v", "bad.v"]);
  assert.equal(await h.picker.apply(), partial);
  assert.equal(reads, 1, "importing files must not start another directory request");
  assert.deepEqual(h.reports, []);
  assert.match(h.control("selection-count").textContent, /1/);
  assert.equal(h.control("cancel").disabled, false);
  assert.equal(h.picker.state(), "selected");
  h.picker.cancel();
  assert.equal(h.picker.state(), "closed");
});

test("a changed target document prevents submit and retains the original document identity", async t => {
  const h = harness(t, {current:{graphId:"graph:old"}});
  await h.picker.open("files import");
  h.picker.choose(["one.v"]);
  h.setContext({documentId:"document:2", documentVersion:2, graphId:"graph:new"});
  await assert.rejects(h.picker.apply(), error => {
    assert.equal(error.code, "STALE_DOCUMENT");
    assert.equal(error.documentId, "document:1");
    assert.equal(error.graphId, "graph:old");
    return true;
  });
  assert.deepEqual(h.submissions, []);
  assert.equal(h.dialog.open, true);
  assert.equal(h.reports.length, 1);
  assert.equal(h.reports[0].details.documentId, "document:1");
  assert.equal(h.reports[0].details.documentVersion, 1);
});

test("busy imports prevent cancellation and duplicate submissions until the receipt returns", async t => {
  const pending = deferred();
  const h = harness(t, {submit:() => pending.promise});
  await h.picker.open("files import");
  h.picker.choose(["one.v"]);
  const applying = h.picker.apply();
  assert.equal(h.picker.state(), "busy");
  assert.equal(h.control("submit").disabled, true);
  assert.equal(h.control("cancel").disabled, true);
  assert.equal(h.control("close").disabled, true);
  assert.throws(() => h.picker.cancel());
  await assert.rejects(h.picker.apply());
  const escape = eventOf("cancel");
  h.dialog.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(h.dialog.open, true);
  pending.resolve({partial:false});
  await applying;
  assert.equal(h.picker.state(), "closed");
  assert.equal(h.submissions.length, 1);
});

test("Compare target and command values stay explicit while Single hides the side control", async t => {
  const h = harness(t, {current:{mode:"Compare"}});
  await h.picker.open("design add", "", "B");
  assert.equal(h.control("side-field").hidden, false);
  assert.equal(h.control("side").value, "B");
  assert.equal(h.control("action").value, "design add");
  h.picker.choose(["one.v"]);
  await h.picker.apply();
  assert.deepEqual(h.submissions[0].slice(0, 3), ["design add", ["ngb-file:one.v"], "B"]);
  h.setContext({mode:"Single"});
  await h.picker.open("files import");
  assert.equal(h.control("side-field").hidden, true);
  assert.equal(h.control("side").value, "");
});

test("Enter navigates the path without closing the form and cancellation restores its opener's focus", async t => {
  const h = harness(t), opener = h.document.activeElement;
  await h.picker.open("files import");
  h.control("path").value = "/work/next";
  const key = eventOf("keydown", {key:"Enter", target:h.control("path")});
  h.control("path").dispatchEvent(key);
  await settle();
  assert.equal(key.defaultPrevented, true);
  assert.equal(h.calls.at(-1).path, "/work/next");
  assert.equal(h.dialog.open, true);
  const formSubmit = eventOf("submit", {target:h.control("form")});
  h.control("form").dispatchEvent(formSubmit);
  assert.equal(formSubmit.defaultPrevented, true);
  assert.equal(h.submissions.length, 0);
  h.picker.cancel();
  assert.equal(h.document.activeElement, opener);
});

test("successful path editing moves focus to the visible Edit path button", async t => {
  const h = harness(t);
  await h.picker.open("files import");
  h.control("edit-path").onclick(eventOf("click"));
  assert.equal(h.control("path-editor").hidden, false);
  assert.equal(h.document.activeElement, h.control("path"));
  assert.equal(h.control("path-editor").contains(h.document.activeElement), true);
  h.control("path").value = "/work/child";
  await h.control("path").onkeydown(eventOf("keydown", {key:"Enter"}));
  assert.equal(h.control("path-editor").hidden, true);
  assert.equal(h.document.activeElement, h.control("edit-path"));
  assert.equal(h.dialog.open, true);
});

test("an asynchronously delivered close event from the previous session does not invalidate a reopened picker", async t => {
  const pending = deferred();
  const h = harness(t, {list:path => path === "/work/new" ? pending.promise : directory("/work", [file("one.v")])});
  await h.picker.open("files import");
  let queuedClose;
  h.dialog.close = function() { this.open = false; queuedClose = eventOf("close"); };
  h.picker.cancel();
  const opening = h.picker.open("files import", "/work/new");
  h.dialog.dispatchEvent(queuedClose);
  pending.resolve(directory("/work/new", [file("new.v")]));
  await opening;
  assert.equal(h.picker.state(), "open");
  assert.equal(h.control("path").value, "/work/new");
  assert.ok(checked(h, "/work/new/new.v"));
  assert.deepEqual(h.reports, []);
});

test("CLI browsing retains its parent request ID and original exception in directory diagnostics", async t => {
  const original = Object.assign(new Error("remote read failed"), {code:"EACCES"});
  const h = harness(t, {list:() => { throw original; }});
  await assert.rejects(h.picker.open("files import", "/work", "", "request:cli-browse"), error => error === original);
  assert.equal(h.reports.length, 1);
  assert.equal(h.reports[0].error, original);
  assert.equal(h.reports[0].details.requestId, "request:cli-browse");
  assert.equal(h.reports[0].details.operation, "files.list");
  assert.equal(h.reports[0].details.documentId, "document:1");
});

function importHarness(t, kind, extension, current = {}) {
  const loaded = [], attempts = [];
  let h, repaired = false;
  const active = {mode:kind === "aig" ? "AIG" : "Single", page:"p1", documentId:"document:1", documentVersion:1, ...current};
  const importFiles = createRemoteFileImport({
    context:() => ({...active}), graphs:{add:assert.fail}, importRequests:createImportRequests(),
    priority:() => 0, loadCellConfig:assert.fail, logFile() {},
    loadText:async (text, options) => {
      attempts.push({name:options.label, append:options.append, compareSide:options.compareSide});
      if (text === "broken") throw Object.assign(new Error("invalid " + kind), {code:"INVALID_INPUT"});
      if (!options.append) loaded.length = 0;
      loaded.push(options.label);
      active.documentVersion++;
      h.setContext(active);
      return kind;
    }
  });
  h = harness(t, {current:active, list:() => directory("/work", [file("good." + extension), file("bad." + extension)]),
    submit:(action, handles, side, _parentId, continuation) => importFiles({id:"picker-import", name:action, opts:{side}, continuation,
      files:handles.map(handle => ({name:handle.slice("ngb-file:".length),
        text:handle.endsWith("bad." + extension) && !repaired ? "broken" : "valid input"}))})});
  return {...h, loaded, attempts, repair:() => { repaired = true; }};
}

for (const [kind, extension, action] of [["netlist", "v", "design open"], ["aig", "blif", null], ["timing", "rpt", "timing open"]]) {
test("retrying auto-detected " + kind + " inputs preserves the first attempt's committed inputs", async t => {
  const h = importHarness(t, kind, extension);
  await h.picker.open("files import");
  h.picker.choose(["good." + extension, "bad." + extension]);
  assert.equal((await h.picker.apply()).partial, true);
  assert.deepEqual(h.loaded, ["good." + extension]);
  h.repair();
  await h.picker.apply();
  assert.deepEqual(h.loaded, ["good." + extension, "bad." + extension], JSON.stringify(h.attempts));
});

if (action) test("a failed explicit " + action + " batch can retry after its earlier input committed", async t => {
  const h = importHarness(t, kind, extension);
  await h.picker.open(action);
  h.picker.choose(["good." + extension, "bad." + extension]);
  await assert.rejects(h.picker.apply(), {code:"INVALID_INPUT"});
  assert.deepEqual(h.loaded, ["good." + extension]);
  h.repair();
  await h.picker.apply();
  assert.deepEqual(h.loaded, ["good." + extension, "bad." + extension], JSON.stringify(h.attempts));
  assert.deepEqual(h.submissions[1][1], ["ngb-file:bad." + extension]);
});
}

test("continuation survives another failed retry until the remaining design succeeds", async t => {
  const h = importHarness(t, "netlist", "v");
  await h.picker.open("files import");
  h.picker.choose(["good.v", "bad.v"]);
  assert.equal((await h.picker.apply()).partial, true);
  await assert.rejects(h.picker.apply(), {code:"IMPORT_FAILED"});
  h.repair();
  await h.picker.apply();
  assert.deepEqual(h.loaded, ["good.v", "bad.v"]);
  assert.deepEqual(h.attempts.map(item => item.append), [false, true, true, true]);
});

test("choosing a different import action starts a new replacement instead of continuing the partial batch", async t => {
  const h = importHarness(t, "netlist", "v");
  await h.picker.open("files import");
  h.picker.choose(["good.v", "bad.v"]);
  await h.picker.apply();
  h.control("action").value = "design open";
  h.control("action").onchange(eventOf("change"));
  h.repair();
  await h.picker.apply();
  assert.deepEqual(h.loaded, ["bad.v"]);
  assert.equal(h.attempts.at(-1).append, false);
  assert.ok(!h.submissions.at(-1)[4]);
});

test("choosing a different Compare side does not reuse the first side's continuation", async t => {
  const h = importHarness(t, "netlist", "v", {mode:"Compare"});
  await h.picker.open("files import", "", "B");
  h.picker.choose(["good.v", "bad.v"]);
  await h.picker.apply();
  h.control("side").value = "A";
  h.control("side").onchange(eventOf("change"));
  h.repair();
  await h.picker.apply();
  assert.equal(h.attempts.at(-1).append, false);
  assert.equal(h.attempts.at(-1).compareSide, "left");
  assert.ok(!h.submissions.at(-1)[4]);
});

for (const method of ["Remove", "checkbox"]) test("clearing the last selection via " + method + " ends the partial batch", async t => {
  const h = importHarness(t, "netlist", "v");
  await h.picker.open("files import");
  h.picker.choose(["good.v", "bad.v"]);
  await h.picker.apply();
  if (method === "Remove") h.control("selected-list").querySelector("button").onclick(eventOf("click"));
  else {
    const checkbox = checked(h, "/work/bad.v");
    checkbox.checked = false;
    checkbox.onchange(eventOf("change"));
  }
  assert.equal(h.picker.state(), "open");
  h.picker.choose(["bad.v"]);
  h.repair();
  await h.picker.apply();
  assert.ok(!h.submissions.at(-1)[4]);
  assert.equal(h.attempts.at(-1).append, false);
  assert.deepEqual(h.loaded, ["bad.v"]);
});

test("an import continuation appends only kinds that actually committed in its previous attempt", async () => {
  const attempts = [];
  const active = {mode:"Single", documentId:"document:1", documentVersion:1};
  let repaired = false;
  const importFiles = createRemoteFileImport({context:() => ({...active}), graphs:{add:assert.fail},
    importRequests:createImportRequests(), priority:() => 0, loadCellConfig:assert.fail, logFile() {},
    loadText:async (_text, options) => {
      attempts.push({kind:options.kind, append:options.append});
      if (options.kind === "timing" && !repaired) throw new Error("bad timing report");
      active.documentVersion++;
      return options.kind;
    }});
  const first = await importFiles({id:"first", name:"files import", opts:{},
    files:[{name:"good.v", text:"module good; endmodule"}, {name:"bad.rpt", text:"timing"}]});
  assert.equal(first.partial, true);
  assert.ok(first.continuation);
  const retry = {id:"retry", name:"files import", opts:{}, continuation:first.continuation,
    files:[{name:"bad.rpt", text:"timing"}]};
  for (const invalid of [
    {...retry, name:"timing add"}, {...retry, opts:{side:"B"}},
    {...retry, continuation:{...first.continuation, documentVersion:active.documentVersion - 1}}
  ]) await assert.rejects(importFiles(invalid), {code:"STALE_DOCUMENT"});
  assert.equal(attempts.length, 2, "a mismatched continuation is rejected before loading another input");
  repaired = true;
  await importFiles(retry);
  assert.deepEqual(attempts, [
    {kind:"netlist", append:false}, {kind:"timing", append:false}, {kind:"timing", append:false}
  ]);
});

test("a mixed-domain retry opens a fresh AIG collection after the netlist import clears the old one", async () => {
  const attempts = [], netlists = [], aigs = [];
  const active = {mode:"Single", documentId:"document:1", documentVersion:1};
  let repaired = false;
  const importFiles = createRemoteFileImport({context:() => ({...active}), graphs:{add:assert.fail},
    importRequests:createImportRequests(), priority:() => 0, loadCellConfig:assert.fail, logFile() {},
    loadText:async (_text, options) => {
      attempts.push({name:options.label, append:options.append});
      if (!repaired && /^(bad|later)/.test(options.label)) throw new Error("invalid input");
      if (options.kind === "netlist") {
        // Netlist activation leaves domain_workbench and clears its AIG collection.
        aigs.length = 0;
        if (!options.append) netlists.length = 0;
        netlists.push(options.label);
        active.mode = "Single";
      } else {
        if (options.append && active.mode !== "AIG")
          throw Object.assign(new Error("Open an AIG before appending to this netlist page"), {code:"DOMAIN_MISMATCH"});
        if (!options.append) aigs.length = 0;
        aigs.push(options.label);
        active.mode = "AIG";
      }
      active.documentVersion++;
      return options.kind;
    }});
  const files = ["good.v", "bad.v", "good.blif", "bad.blif", "later.blif"].map(name => ({name, text:"input"}));
  const first = await importFiles({id:"mixed", name:"files import", opts:{}, files});
  assert.equal(first.partial, true);
  assert.deepEqual(aigs, ["good.blif"]);
  repaired = true;
  const remaining = files.filter((_file, index) => first.files[index].status !== "committed");
  const result = await importFiles({id:"retry", name:"files import", opts:{}, files:remaining, continuation:first.continuation});
  assert.equal(result.partial, false);
  assert.deepEqual(netlists, ["good.v", "bad.v"]);
  assert.deepEqual(aigs, ["bad.blif", "later.blif"]);
  assert.deepEqual(attempts.slice(-3), [
    {name:"bad.v", append:true}, {name:"bad.blif", append:false}, {name:"later.blif", append:true}
  ]);
});
