import assert from "node:assert/strict";
import test from "node:test";
import { createBulkTextInput, BULK_TEXT_THRESHOLD, BULK_TEXT_PREVIEW_LIMIT } from "../../src/ui/bulk_text_input.js";

function fixture() {
  const target = () => ({ listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } });
  const input = Object.assign(target(), {
    value: "", selectionStart: 0, selectionEnd: 0, focus() {},
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  });
  const expandButton = target(), clearButton = target(), notice = {};
  const buffer = createBulkTextInput({ input, expandButton, clearButton, notice });
  const paste = (text) => {
    let prevented = false;
    input.listeners.paste({ clipboardData: { types: ["text/plain"], getData: () => text },
      preventDefault() { prevented = true; } });
    return prevented;
  };
  return { input, buffer, notice, expandButton, clearButton, paste };
}

test("bulk paste retains the complete source while selection and replacement use a bounded preview", () => {
  const f = fixture();
  const source = "// long netlist\n".repeat(BULK_TEXT_THRESHOLD) + "module tail; endmodule";
  assert.equal(f.paste(source), true);
  assert.equal(f.buffer.getValue(), source);
  assert.ok(f.input.value.length <= BULK_TEXT_PREVIEW_LIMIT);
  assert.equal(f.input.readOnly, true);
  assert.equal(f.notice.hidden, false);
  f.input.setSelectionRange(0, f.input.value.length);
  let copied;
  f.input.listeners.copy({ clipboardData: { setData: (type, value) => { copied = value; } }, preventDefault() {} });
  assert.equal(copied, source);
  assert.equal(f.paste("module replacement; endmodule"), true);
  assert.equal(f.buffer.getValue(), "module replacement; endmodule");
  assert.equal(f.input.readOnly, false);
  assert.equal(f.notice.hidden, true);
});

test("normal editing and partial copy retain native behavior; expanding preserves the tail", () => {
  const f = fixture();
  assert.equal(f.paste("short"), false);
  const source = "x".repeat(BULK_TEXT_THRESHOLD + 1) + "tail";
  f.buffer.setValue(source);
  f.input.setSelectionRange(1, 5);
  f.input.listeners.copy({ clipboardData: {}, preventDefault() { assert.fail("partial copy must stay native"); } });
  f.expandButton.listeners.click();
  assert.equal(f.input.value, source);
  assert.equal(f.input.readOnly, false);
  f.input.value += " edited";
  f.input.listeners.input({});
  assert.equal(f.buffer.getValue(), source + " edited");
  f.clearButton.listeners.click();
  assert.equal(f.buffer.getValue(), "");
});

test("bulk paste into an editable range preserves prefix and suffix; select-all Delete clears the buffer", () => {
  const f = fixture();
  f.input.value = "prefix OLD suffix";
  f.input.setSelectionRange(7, 10);
  const inserted = "z".repeat(BULK_TEXT_THRESHOLD + 1);
  f.paste(inserted);
  assert.equal(f.buffer.getValue(), `prefix ${inserted} suffix`);
  f.input.setSelectionRange(0, f.input.value.length);
  f.input.listeners.keydown({ key: "Delete", preventDefault() {} });
  assert.equal(f.buffer.getValue(), "");
  assert.equal(f.input.readOnly, false);
});
