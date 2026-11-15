import test from "node:test";
import assert from "node:assert/strict";
import { copyBrowserText } from "../../src/platform/browser_clipboard.js";

test("browser clipboard preserves literal source text and the native receiver", async () => {
  const text = "  \\source/id <&>\t\n";
  const clipboard = { async writeText(value) { assert.equal(this, clipboard); assert.equal(value, text); } };
  await copyBrowserText(text, clipboard);
});

test("clipboard absence and synchronous or async permission failures reject safely", async () => {
  for (const clipboard of [undefined, {}]) await assert.rejects(copyBrowserText("text", clipboard), /Clipboard unavailable/);
  const failure = new Error("Clipboard permission denied");
  for (const writeText of [() => { throw failure; }, async () => { throw failure; }]) {
    const pending = copyBrowserText("text", { writeText });
    await assert.rejects(pending, (error) => error === failure);
  }
});
