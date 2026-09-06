import test from "node:test";
import assert from "node:assert/strict";
import { beginWorkspaceRequest } from "../../src/app/workspaceRequest.js";

function state() {
  return { layoutRequestId: 0, design: {}, currentModule: {}, compare: { active: false } };
}

test("obsolete success and failure callbacks cannot commit", async () => {
  const app = state();
  const first = beginWorkspaceRequest(app);
  const events = [];
  const second = beginWorkspaceRequest(app);
  await Promise.resolve("old").then(first.guard((value) => events.push(value)));
  await Promise.reject(new Error("old error")).catch(first.guard(() => events.push("error")));
  await Promise.resolve("current").then(second.guard((value) => events.push(value)));
  assert.deepEqual(events, ["current"]);
});

test("design, module and compare transitions invalidate captured callbacks", () => {
  for (const change of [
    (app) => { app.design = {}; },
    (app) => { app.currentModule = {}; },
    (app) => { app.compare.active = true; },
    (app) => { app.compare.leftModuleName = "other"; }
  ]) {
    const app = state();
    const request = beginWorkspaceRequest(app);
    change(app);
    assert.equal(request.isCurrent(), false);
  }
});
