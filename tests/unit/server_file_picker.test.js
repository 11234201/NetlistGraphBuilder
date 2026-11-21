import assert from "node:assert/strict";
import test from "node:test";
import {posix,win32} from "node:path";
import {createServerFilePicker} from "../../src/ui/server_file_picker.js";

function makeDocument() {
  const controls = new Map();
  function element() {
    return {children:[],value:"",append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; }, add(item) { this.children.push(item); },
      addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; },
      querySelector(key) {
        if (!controls.has(key)) controls.set(key,element());
        return controls.get(key);
      }};
  }
  const body = element();
  return {document:{body,createElement:element,createTextNode:text => text},controls};
}

for (const [name,fs,roots,file] of [
  ["drive",win32,["C:\\project","D:\\designs"],"input.v"],
  ["network share",win32,["\\\\server\\public","\\\\server\\designs"],"input.v"],
  ["POSIX backslash in file name",posix,["/project","/designs"],"input\\example.v"]
]) test("server picker uses host paths and submits the listed handle for "+name, async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis,"Option");
  Object.defineProperty(globalThis,"Option",{configurable:true,value:class {}});
  t.after(() => { if (original) Object.defineProperty(globalThis,"Option",original); else delete globalThis.Option; });
  const {document,controls} = makeDocument();
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
  assert.equal(controls.get("[data-entries]").children[0].children[0].children[0].checked,true);
  await picker.apply();
  assert.deepEqual(selected,["ngb-file:visible"]);
  await picker.open("design open",child);
  await controls.get("[data-up]").onclick();
  assert.equal(fs.normalize(controls.get("[data-path]").value),fs.normalize(root));
  assert.equal(controls.get("[data-up]").disabled,true);
});
