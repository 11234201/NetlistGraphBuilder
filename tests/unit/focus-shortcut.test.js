import test from "node:test";
import assert from "node:assert/strict";
import { handleFocusShortcut } from "../../src/ui/focus_shortcut.js";

test("focus shortcut preserves browser shortcuts, editable input and modal dialogs", () => {
  for (const context of [{ ctrlKey: true }, { metaKey: true }, { altKey: true },
    { isComposing: true }, { defaultPrevented: true }, { key: "Escape" },
    { target: { closest: () => ({}) } },
    { target: { closest: (selector) => selector === "dialog[open]" ? {} : null } }]) {
    let prevented = false, focused = false;
    handleFocusShortcut({ key: "f", ...context, preventDefault() { prevented = true; } }, () => { focused = true; });
    assert.equal(prevented, false, JSON.stringify(context));
    assert.equal(focused, false, JSON.stringify(context));
  }
});

test("focus shortcut accepts F only when a focusable selection is available", () => {
  let prevented = 0, focused = 0;
  const event = { key: "F", target: { closest: () => null }, preventDefault() { prevented += 1; } };
  handleFocusShortcut(event, () => { focused += 1; }, false);
  assert.equal(prevented, 0);
  assert.equal(focused, 0);
  handleFocusShortcut(event, () => { focused += 1; }, true);
  assert.equal(prevented, 1);
  assert.equal(focused, 1);
});
