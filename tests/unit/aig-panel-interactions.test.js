import test from "node:test";
import assert from "node:assert/strict";
import { createAigPanelInteractions } from "../../src/ui/aig_panel_interactions.js";

function fixture() {
  const document = { activeElement: null };
  function createHost() {
    const handlers = new Map();
    let controls = [];
    const host = {
      addEventListener(type, handler) { handlers.set(type, handler); },
      emit(type, event) { handlers.get(type)?.(event); },
      contains(element) { return controls.includes(element); },
      querySelectorAll(selector) {
        if (selector === "[data-aig-filter]") return controls.filter((control) => control.dataset.aigFilter);
        if (selector === '[role="tab"]') return controls.filter((control) => control.role === "tab");
        return controls;
      },
      querySelector() { return controls.find((control) => control.role === "tab" && control.selected); },
      set innerHTML(specs) {
        controls = specs.map((spec) => ({
          ...spec, dataset: { ...spec.dataset }, parentElement: host,
          focus() { document.activeElement = this; },
          setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
          closest(selector) { return selector === '[role="tab"]' && this.role !== "tab" ? null : this; },
          click() { host.emit("click", { target: this }); }
        }));
      }
    };
    return host;
  }
  const navigatorHost = createHost(), inspectorHost = createHost(), actions = [], filters = [];
  const controller = createAigPanelInteractions({ document, navigatorHost, inspectorHost,
    onAction(data) { actions.push({ ...data }); }, onFilter(field, value) { filters.push([field, value]); } });
  return { document, navigatorHost, inspectorHost, actions, filters, controller };
}

const tab = (id, selected = false) => ({ role: "tab", selected, dataset: { aigNavTab: id } });

test("panel redraw preserves activated tabs, selected objects and filter carets", () => {
  const f = fixture();
  const navigator = [tab("design"), tab("objects", true), { dataset: { aigSelect: "node:1" } },
    { type: "search", value: "input", selectionStart: 2, selectionEnd: 4, dataset: { aigFilter: "query" } }];
  for (const index of [1, 2, 3]) {
    f.controller.render({ navigator, inspector: [] });
    const old = f.navigatorHost.querySelectorAll("controls")[index];
    old.focus();
    f.controller.render({ navigator, inspector: [] });
    assert.notEqual(f.document.activeElement, old);
    assert.deepEqual(f.document.activeElement.dataset, old.dataset);
    if (index === 3) assert.deepEqual([f.document.activeElement.selectionStart, f.document.activeElement.selectionEnd], [2, 4]);
  }
});

test("panel pager focus follows the same direction and moves to the enabled button at a boundary", () => {
  const f = fixture();
  const pager = (page, last = false) => [
    { disabled: page === 0, dataset: { aigPage: String(page - 1), aigPageTarget: "navigator" } },
    { disabled: last, dataset: { aigPage: String(page + 1), aigPageTarget: "navigator" } }
  ];
  f.controller.render({ navigator: pager(0), inspector: [] });
  f.navigatorHost.querySelectorAll("controls")[1].focus();
  f.controller.render({ navigator: pager(1), inspector: [] });
  assert.equal(f.document.activeElement.dataset.aigPage, "2");
  f.controller.render({ navigator: pager(2, true), inspector: [] });
  assert.equal(f.document.activeElement.dataset.aigPage, "1");
  assert.equal(f.document.activeElement.disabled, false);
});

test("show-selection focus follows its revealed object and removed inspector controls fall back to its active tab", () => {
  const f = fixture();
  f.controller.render({ navigator: [{ dataset: { aigShowSelection: "node:1" } }], inspector: [] });
  f.navigatorHost.querySelectorAll("controls")[0].focus();
  f.controller.render({ navigator: [{ dataset: { aigSelect: "node:1" } }], inspector: [] });
  assert.equal(f.document.activeElement.dataset.aigSelect, "node:1");
  f.controller.render({ navigator: [], inspector: [{ dataset: { aigSelect: "old" } }] });
  f.inspectorHost.querySelectorAll("controls")[0].focus();
  f.controller.render({ navigator: [], inspector: [{ role: "tab", selected: true, dataset: { aigInspectorTab: "connections" } }] });
  assert.equal(f.document.activeElement.dataset.aigInspectorTab, "connections");
});

test("composition keeps its input alive until completion and applies the final filter once", () => {
  const f = fixture();
  f.controller.render({ navigator: [{ type: "search", value: "", dataset: { aigFilter: "query" } }], inspector: [] });
  const input = f.navigatorHost.querySelectorAll("controls")[0];
  input.focus();
  f.navigatorHost.emit("compositionstart", { target: input });
  input.value = "雪";
  f.navigatorHost.emit("input", { target: input, isComposing: true });
  f.navigatorHost.emit("input", { target: input, isComposing: false });
  f.controller.render({ navigator: [{ type: "search", value: "", dataset: { aigFilter: "query" } }], inspector: [] });
  assert.equal(f.navigatorHost.contains(input), true, "async analysis must not replace an active composition");
  assert.deepEqual(f.filters, []);
  assert.equal(f.document.activeElement, input);
  f.navigatorHost.emit("compositionend", { target: input });
  f.navigatorHost.emit("input", { target: input });
  f.navigatorHost.emit("change", { target: input });
  assert.deepEqual(f.filters, [["query", "雪"]]);
});

test("panel arrow, Home and End keys retain their tab navigation behavior", () => {
  const f = fixture();
  f.controller.render({ navigator: [tab("design", true), tab("objects")], inspector: [] });
  for (const [key, current, expected] of [["ArrowRight", 0, "objects"], ["ArrowLeft", 0, "objects"], ["Home", 1, "design"], ["End", 0, "objects"]]) {
    let prevented = false;
    f.navigatorHost.emit("keydown", { target: f.navigatorHost.querySelectorAll("controls")[current], key, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(f.actions.at(-1).aigNavTab, expected);
    assert.equal(f.document.activeElement.dataset.aigNavTab, expected);
  }
});

test("following an Inspector analysis link keeps keyboard focus in the replacement details", () => {
  const f = fixture();
  f.controller.render({ navigator: [], inspector: [{ dataset: { aigAnalysisSelect: "next-result" } }] });
  const old = f.inspectorHost.querySelectorAll("controls")[0]; old.focus();
  f.controller.render({ navigator: [], inspector: [{ dataset: { aigAnalysisAction: "locate" } }, { dataset: { aigAnalysisAction: "clear" } }] });
  assert.equal(f.inspectorHost.contains(f.document.activeElement), true);
  assert.equal(f.document.activeElement.dataset.aigAnalysisAction, "locate");
});
