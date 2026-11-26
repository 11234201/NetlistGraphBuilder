import assert from "node:assert/strict";
import test from "node:test";
import {createServerFilePicker} from "../../src/ui/server_file_picker.js";
import {makePickerDocument, eventOf, settle, deferred, fakeClock} from "../helpers/server_picker_dom.js";

const directory = (path, entries = [], number = 1, total = entries.length) =>
  ({path, entries, number, total, roots:["/work"]});
const file = name => ({name, handle:"ngb-file:" + name});
function harness(list) {
  const dom = makePickerDocument(), clock = fakeClock(), calls = [], reports = [];
  const picker = createServerFilePicker({document:dom.document, timers:clock,
    context:() => ({mode:"Single", page:"p1", documentId:"document:1", documentVersion:1}),
    list:async (path, filter, number) => { calls.push({path, filter, number}); return list(path, filter, number); },
    submit:async () => ({partial:false}), report:(error, details) => reports.push({error, details})});
  return {...dom, picker, clock, calls, reports};
}

test("filter changes keep the pending directory for debounce, Enter and Clear", async t => {
  for (const action of ["debounce", "enter", "clear"]) await t.test(action, async () => {
    const pending = deferred();
    let held = false;
    const h = harness((path, filter) => {
      if (path === "/work/child" && !held) { held = true; return pending.promise; }
      return directory(path, path === "/work" ? [{name:"child", directory:true}] : [file(filter || "unfiltered.v")]);
    });
    await h.picker.open("files import", "/work");
    const navigating = h.control("entries").children[0].onclick();
    h.control("filter").value = "child-match.v";
    h.control("filter").oninput();
    if (action === "debounce") { h.clock.tick(200); await settle(); }
    if (action === "enter") await h.control("filter").onkeydown(eventOf("keydown", {key:"Enter"}));
    if (action === "clear") await h.control("filter-clear").onclick();
    assert.equal(h.calls.at(-1).path, "/work/child");
    assert.equal(h.calls.at(-1).filter, action === "clear" ? "" : "child-match.v");
    pending.resolve(directory("/work/child", [file("old-result.v")]));
    await navigating;
    assert.equal(h.control("path").value, "/work/child");
    assert.ok(!h.control("entries").textContent.includes("old-result.v"));
    assert.deepEqual(h.reports, []);
  });
});

test("directory responses preserve a path draft until its unchanged submission succeeds", async t => {
  for (const operation of ["filter", "path"]) await t.test(operation, async () => {
    const pending = deferred();
    let holdNext = false;
    const h = harness(path => {
      if (holdNext) { holdNext = false; return pending.promise; }
      return directory(path, [file("design.v")]);
    });
    await h.picker.open("files import", "/work");
    holdNext = true;
    let navigation;
    if (operation === "filter") {
      h.control("filter").value = "design"; h.control("filter").oninput(); h.clock.tick(200);
      h.control("edit-path").onclick();
    } else {
      h.control("edit-path").onclick();
      h.control("path").value = "/work/submitted"; h.control("path").oninput();
      navigation = h.control("path").onkeydown(eventOf("keydown", {key:"Enter"}));
    }
    h.control("path").value = "/work/new-draft"; h.control("path").oninput();
    pending.resolve(directory(operation === "path" ? "/work/submitted" : "/work", [file("design.v")]));
    await navigation; await settle();
    assert.equal(h.control("path-editor").hidden, false);
    assert.equal(h.control("path").value, "/work/new-draft");
    assert.equal(h.document.activeElement, h.control("path"));
    await h.control("path").onkeydown(eventOf("keydown", {key:"Enter"}));
    assert.equal(h.control("path-editor").hidden, true);
    assert.equal(h.control("path").value, "/work/new-draft");
    assert.equal(h.document.activeElement, h.control("edit-path"));
    assert.deepEqual(h.reports, []);
  });
});

test("shrinking directory pages have one bounded correction with truthful empty states and diagnostics", async t => {
  await t.test("a stale page loads the new final page", async () => {
    let count = 0;
    const h = harness((path, _filter, page) => {
      count++;
      if (count === 1) return directory(path, [file("first.v")], 1, 105);
      if (count === 2) return directory(path, [], 2, 99);
      return directory(path, [file("remaining.v")], page, 99);
    });
    await h.picker.open("files import", "/work");
    await h.control("next").onclick();
    assert.deepEqual(h.calls.map(call => call.number), [1, 2, 1]);
    assert.match(h.control("entries").textContent, /remaining.v/);
    assert.equal(h.control("prev").disabled, true);
    assert.deepEqual(h.reports, []);
  });
  for (const remaining of [99, 0]) await t.test("a second shrink stops retrying with " + remaining + " files", async () => {
    let count = 0;
    const h = harness((path, _filter, page) => {
      count++;
      if (count <= 2) return directory(path, [file("design.v")], page, 205);
      return count === 3 ? directory(path, [], page, 105) : directory(path, [], page, remaining);
    });
    await h.picker.open("files import", "/work");
    await h.control("next").onclick();
    await h.control("next").onclick();
    assert.deepEqual(h.calls.map(call => call.number), [1, 2, 3, 2]);
    assert.equal(h.control("prev").disabled, false);
    assert.match(h.control("list-state").textContent, /No files on this page/);
    assert.match(h.control("count").textContent, new RegExp("^0 of " + remaining + " · Page 2"));
    assert.deepEqual(h.reports, []);
  });
  await t.test("correction failures retain their original exception and request context", async () => {
    const original = Object.assign(new Error("directory disconnected"), {code:"EIO"});
    let count = 0;
    const h = harness((path, _filter, page) => {
      if (++count === 1) return directory(path, [file("design.v")], page, 105);
      if (count === 2) return directory(path, [], page, 99);
      throw original;
    });
    await h.picker.open("files import", "/work");
    await h.control("next").onclick();
    assert.equal(h.calls.length, 3);
    assert.equal(h.reports.length, 1);
    assert.equal(h.reports[0].error, original);
    assert.equal(h.reports[0].details.operation, "files.list");
    assert.equal(h.reports[0].details.code, "EIO");
    assert.match(h.reports[0].details.requestId, /^picker-list-/);
    assert.equal(h.reports[0].details.pageNumber, 2);
    assert.equal(h.reports[0].details.correctedPageNumber, 1);
    assert.equal(h.reports[0].details.documentId, "document:1");
    assert.equal(h.control("retry").hidden, false);
  });
  await t.test("a superseded correction cannot overwrite or report against a newer directory", async () => {
    const pending = deferred();
    let count = 0;
    const h = harness((path, _filter, page) => {
      if (path === "/work/new") return directory(path, [file("new.v")]);
      if (++count === 1) return directory(path, [file("old.v")], page, 105);
      if (count === 2) return directory(path, [], page, 99);
      return pending.promise;
    });
    await h.picker.open("files import", "/work");
    const navigating = h.control("next").onclick();
    await settle();
    assert.equal(count, 3);
    await h.picker.open("files import", "/work/new");
    pending.reject(new Error("old correction failed"));
    await navigating;
    assert.equal(h.control("path").value, "/work/new");
    assert.match(h.control("entries").textContent, /new.v/);
    assert.deepEqual(h.reports, []);
  });
});

test("file type hints exclude inherited object properties and preserve special names", async () => {
  const names = ["special.constructor", "special.__proto__", "normal.v", "<script>alert(1)</script>.v", "back\\slash.v"];
  const h = harness(path => directory(path, names.map(file)));
  await h.picker.open("files import", "/work");
  assert.deepEqual(h.control("entries").children.map(row => row.querySelector(".server-file-name").textContent), names);
  assert.deepEqual(h.control("entries").children.map(row => row.querySelector(".server-file-kind").textContent),
    ["File", "File", "Verilog", "Verilog", "Verilog"]);
  assert.deepEqual(h.reports, []);
});
