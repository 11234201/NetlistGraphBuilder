import assert from "node:assert/strict";
import test from "node:test";
import { createFocusedRootsController } from "../../src/app/focused_roots_controller.js";
import { captureFocusedRootsFocus } from "../../src/ui/focused_roots_focus.js";

function createFixture({ roots, refs, nodes = [], compare = false, services = {} }) {
  const graph = { nodes, edges: [] };
  const state = {
    compare: {
      active: compare, selectedSide: "right", graphs: { right: graph },
      focusedRootNodeIds: { right: roots }, focusedRootRefs: { right: refs },
      activeFocusedRootNodeId: { right: roots[0] }
    },
    focusedRootNodeIds: roots, focusedRootRefs: refs, activeFocusedRootNodeId: roots[0],
    fullGraph: graph, graph
  };
  const elements = { focusedRootsList: { innerHTML: "", textContent: "" }, focusedRootCount: {} };
  const controller = createFocusedRootsController({ state, elements, services });
  return { state, elements, controller };
}

test("all 32 Focused roots remain reachable when filtering the bounded list", () => {
  const roots = Object.freeze(Array.from({ length: 32 }, (_, index) => `cell:u${String(index).padStart(2, "0")}`));
  const nodes = roots.map((id) => ({ id, label: id.slice(5) }));
  const { controller, elements, state } = createFixture({ roots, nodes });
  const countRows = () => (elements.focusedRootsList.innerHTML.match(/class="focused-root-chip/g) || []).length;
  controller.renderFocusedRootList();
  assert.equal(countRows(), 32);
  assert.equal(elements.focusedRootCount.textContent, "32");
  for (const root of roots) {
    controller.handleFocusedRootsFilter({ target: { value: root.toUpperCase() } });
    assert.equal(countRows(), 1);
    assert.ok(elements.focusedRootsList.innerHTML.includes(`data-focused-root-activate="${root}"`));
    assert.equal(elements.focusedRootCount.textContent, "32");
  }
  controller.handleFocusedRootsFilter({ target: { value: "missing" } });
  assert.equal(elements.focusedRootsList.innerHTML, "No matching roots");
  controller.handleFocusedRootsFilter({ target: { value: "" } });
  assert.equal(countRows(), 32);
  assert.equal(state.focusedRootNodeIds, roots);
});

test("root filtering retains occurrence references, escaping and native keyboard controls", () => {
  for (const compare of [false, true]) {
    const roots = ["cell:u0", "net:encoded-root"];
    const refs = [
      { kind: "cell", localId: "cell:u0", occurrencePath: ["other"] },
      { kind: "net", localId: 'bus<"&>', occurrencePath: ["top", "INSTANCE"] }
    ];
    const { controller, elements } = createFixture({ roots, refs, compare });
    controller.handleFocusedRootsFilter({ target: { value: "instance" } });
    const markup = elements.focusedRootsList.innerHTML;
    assert.match(markup, /<button type="button" class="focused-root-activate" aria-pressed="false" data-focused-root-activate="net:encoded-root">/);
    assert.match(markup, /top\/INSTANCE · net bus&lt;&quot;&amp;&gt;/);
    assert.match(markup, /<\/button><button type="button" aria-label="Remove /);
    assert.match(markup, /data-focused-root-remove="net:encoded-root"/);
    assert.doesNotMatch(markup, /data-focused-root-activate="cell:u0"/);
    if (compare) assert.match(markup, /<span>B: top\/INSTANCE/);
    controller.handleFocusedRootsFilter({ target: { value: 'bus<"&>' } });
    assert.ok(elements.focusedRootsList.innerHTML.includes('data-focused-root-activate="net:encoded-root"'));
  }
});

test("the root activation button uses the existing activation command without removing roots", () => {
  const commands = [];
  const { controller, state } = createFixture({
    roots: ["net:n"],
    services: {
      singleViewSession: {
        objectRefForNet: (name) => ({ kind: "net", localId: name }),
        dispatch: (command) => commands.push(command)
      },
      updateViewControls() {}, setStatus() {}
    }
  });
  controller.handleFocusedRootListClick({ target: {
    closest: (selector) => selector === "[data-focused-root-activate]"
      ? { dataset: { focusedRootActivate: "net:n" } } : null
  } });
  assert.deepEqual(commands, [{ type: "focus.activate", objectRef: { kind: "net", localId: "n" } }]);
  assert.deepEqual(state.focusedRootNodeIds, ["net:n"]);
});

function focusFixture(ids) {
  const focused = [];
  const makeButton = (id, action = "focusedRootActivate") => ({
    dataset: { [action]: id },
    closest(selector) { return selector.includes("[hidden]") ? null : this; },
    focus: () => focused.push([action, id])
  });
  const filter = { closest: () => null, focus: () => focused.push("filter") };
  const summary = { closest: () => null, focus: () => focused.push("summary") };
  const document = { getElementById: (id) => id === "focusedRootsFilter" ? filter : { querySelector: () => summary } };
  const list = {
    ownerDocument: document, buttons: [],
    contains(button) { return this.buttons.includes(button); },
    querySelectorAll(selector) {
      return selector.includes(",") ? this.buttons : this.buttons.filter((item) => item.dataset.focusedRootActivate !== undefined);
    }
  };
  const replace = (nextIds) => { list.buttons = nextIds.flatMap((id) => [makeButton(id), makeButton(id, "focusedRootRemove")]); };
  replace(ids);
  return { document, list, filter, focused, replace };
}

test("roots redraw restores the same keyboard action without stealing external focus", () => {
  for (const action of ["focusedRootActivate", "focusedRootRemove"]) {
    const fixture = focusFixture(["a", "b"]);
    fixture.document.activeElement = fixture.list.buttons.find((item) => item.dataset[action] === "b");
    const restore = captureFocusedRootsFocus(fixture.list);
    fixture.replace(["a", "b"]);
    restore();
    assert.deepEqual(fixture.focused, [[action, "b"]]);
  }
  const fixture = focusFixture(["a"]);
  fixture.document.activeElement = { closest: () => null };
  const restore = captureFocusedRootsFocus(fixture.list);
  fixture.replace(["b"]);
  restore();
  assert.deepEqual(fixture.focused, []);
});

test("removed roots move keyboard focus to a visible neighbor or the empty-list controls", () => {
  for (const [removed, nextIds, expected] of [
    ["b", ["a", "c"], ["focusedRootActivate", "c"]],
    ["c", ["a", "b"], ["focusedRootActivate", "b"]],
    ["a", [], "filter"]
  ]) {
    const fixture = focusFixture(["a", "b", "c"]);
    fixture.document.activeElement = fixture.list.buttons.find((item) => item.dataset.focusedRootRemove === removed);
    const restore = captureFocusedRootsFocus(fixture.list);
    fixture.replace(nextIds);
    restore();
    assert.deepEqual(fixture.focused, [expected]);
  }
  const fixture = focusFixture(["a"]);
  fixture.document.activeElement = fixture.list.buttons[0];
  const restore = captureFocusedRootsFocus(fixture.list);
  fixture.replace([]);
  fixture.filter.closest = () => ({});
  restore();
  assert.deepEqual(fixture.focused, ["summary"]);
});
