import assert from "node:assert/strict";
import test from "node:test";
import { createUiPreferencesStore } from "../../src/app/ui_preferences.js";
import { UI_PREFERENCES_KEY } from "../../src/platform/ui_preferences_storage.js";
import { decodeUiPreferences, encodeUiPreferences } from "../../src/persistence/ui_preferences_codec.js";

test("UI preferences keep only valid shell fields and remain separate from business snapshots", () => {
  const decoded = decodeUiPreferences(encodeUiPreferences({
    navigatorOpen: false, inspectorOpen: "false", navigatorWidth: 900, inspectorWidth: -2,
    navigatorTab: "design", inspectorTab: "timing", source: "private netlist", focusedRootRefs: ["cell:a"]
  }));
  assert.deepEqual(decoded, {
    navigatorOpen: false, inspectorOpen: null, navigatorWidth: 360, inspectorWidth: 320,
    navigatorTab: "design", inspectorTab: "timing"
  });
  assert.throws(() => decodeUiPreferences('{"version":2}'), /version/);
  assert.throws(() => decodeUiPreferences("{"), SyntaxError);
});

test("UI storage uses its own key and tolerates unavailable localStorage access", () => {
  const entries = new Map();
  const storage = { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  const store = createUiPreferencesStore({ storage });
  store.save({ navigatorOpen: true, inspectorTab: "adjust" });
  assert.deepEqual([...entries.keys()], [UI_PREFERENCES_KEY]);
  assert.equal(store.load().inspectorTab, "adjust");
  const failures = [];
  const broken = createUiPreferencesStore({
    windowTarget: { get localStorage() { throw new Error("denied"); } },
    onError: (error, context) => failures.push([error.message, context.operation])
  });
  assert.equal(broken.load().navigatorOpen, null);
  assert.equal(broken.save({}), false);
  assert.equal(broken.save({}), false);
  assert.deepEqual(failures, [["denied", "load"], ["denied", "save"]]);
});

test("malformed saved preferences fall back without replacing stored business data", () => {
  const writes = [];
  const store = createUiPreferencesStore({
    storage: { getItem: () => '{"version":99}', setItem: (...args) => writes.push(args) },
    onError: () => { throw new Error("diagnostic unavailable"); }
  });
  assert.equal(store.load().navigatorTab, "hierarchy");
  assert.deepEqual(writes, []);
});
