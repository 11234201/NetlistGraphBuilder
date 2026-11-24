import assert from "node:assert/strict";
import test from "node:test";
import { formatWorkbenchReply } from "../../tools/workbench_display.mjs";

test("prompt separates nested fields, multiline values and job context", () => {
  const reply = {status:"partial", page:"p2", side:"B", requestId:"r7",
    result:{gateCount:2, notes:["first line\nsecond line", "\x1b[31m"]}};
  assert.equal(formatWorkbenchReply(reply, "analysis run"),
    "Partial\nPage: p2   Side: B   Request: r7\nGate Count: 2\nNotes:\n  - first line\n    second line\n  - \\u001b[31m");
  assert.equal(reply.result.notes[1], "\x1b[31m");
});

test("prompt puts the failure reason before candidate pages", () => {
  const reply = {status:"failed", error:{code:"PAGE_REQUIRED", message:"Choose a connected page", candidates:["p1","p2"]}};
  assert.equal(formatWorkbenchReply(reply, "fs pwd"), "Failed [PAGE_REQUIRED]  Choose a connected page\nCandidates:\n  - p1\n  - p2");
});
