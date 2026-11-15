import assert from "node:assert/strict";
import test from "node:test";
import { createInputController } from "../../src/app/input_controller.js";
import { createAppState } from "../../src/app/appState.js";
import { DEFAULT_LAYOUT_POLICY } from "../../src/layout/layoutPolicy.js";
import { createImportRequests } from "../../src/application/import_requests.js";

test("a late startup response or failure cannot mutate a newer document or run fallback", async () => {
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "location", { configurable: true, value: { search: "?startup=1" } });
  try {
    for (const outcome of ["response", "failure"]) {
      const importRequests = createImportRequests();
      const state = createAppState(DEFAULT_LAYOUT_POLICY);
      const logs = [];
      let resolveFetch, rejectFetch, signal;
      globalThis.fetch = (_url, options) => {
        signal = options.signal;
        // Deliberately ignore abort to also guard transports that complete late.
        return new Promise((resolve, reject) => { resolveFetch = resolve; rejectFetch = reject; });
      };
      const controller = createInputController({ state, elements: {}, services: {
        importRequests, logProcess: (...args) => logs.push(args)
      } });
      const pending = controller.initializeApplication(null);
      const latest = importRequests.begin();
      assert.equal(signal.aborted, true);
      if (outcome === "failure") rejectFetch(new Error("obsolete startup failure"));
      else resolveFetch({ ok: true, json: async () => ({ version: 1,
        inputs: { netlist: { name: "obsolete.v", text: "module obsolete; endmodule" } }, target: {} }) });
      await pending;
      assert.equal(state.currentSource, null);
      assert.deepEqual(logs, []);
      assert.equal(latest.isCurrent(), true);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (locationDescriptor) Object.defineProperty(globalThis, "location", locationDescriptor);
    else delete globalThis.location;
  }
});
