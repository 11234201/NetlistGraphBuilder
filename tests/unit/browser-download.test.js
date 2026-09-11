import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserDownload, sanitizeDownloadFileName } from "../../src/platform/browser_download.js";

test("browser download adapter owns URL lifecycle and typed file metadata", () => {
  const calls = [];
  class FakeBlob {
    constructor(parts, options) { this.parts = parts; this.type = options.type; }
  }
  const link = { click: () => calls.push(["click", link.href, link.download]) };
  const adapter = createBrowserDownload({
    BlobImpl: FakeBlob,
    URLImpl: {
      createObjectURL(blob) { calls.push(["create", blob.parts[0], blob.type]); return "blob:test"; },
      revokeObjectURL(url) { calls.push(["revoke", url]); }
    },
    createElement: (name) => (assert.equal(name, "a"), link)
  });
  adapter.text("content", "result.svg", "image/svg+xml");
  assert.deepEqual(calls, [
    ["create", "content", "image/svg+xml"],
    ["click", "blob:test", "result.svg"],
    ["revoke", "blob:test"]
  ]);
});

test("download names and JSON serialization are deterministic", () => {
  assert.equal(sanitizeDownloadFileName("top/core [0]"), "top_core_0_");
  const created = [];
  const adapter = createBrowserDownload({
    BlobImpl: class { constructor(parts) { this.parts = parts; } },
    URLImpl: { createObjectURL: (blob) => (created.push(blob.parts[0]), "blob:x"), revokeObjectURL() {} },
    createElement: () => ({ click() {} })
  });
  adapter.json({ b: 2, a: 1 }, "state.json");
  assert.equal(created[0], '{\n  "b": 2,\n  "a": 1\n}\n');
  const { json } = adapter;
  json({ ok: true }, "detached.json");
  assert.equal(created[1], '{\n  "ok": true\n}\n');
});
