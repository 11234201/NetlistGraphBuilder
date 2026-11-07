import assert from "node:assert/strict";
import test from "node:test";
import { renderOccurrenceChoices } from "../../src/ui/occurrence_choice_panel.js";

test("occurrence chooser renders every canonical path and escapes labels", () => {
  const html = renderOccurrenceChoices([
    { moduleName: "child", rootModuleName: "top", occurrencePath: ["u0"] },
    { moduleName: "child", rootModuleName: "top", occurrencePath: ["u1", "x&y"] }
  ], "child");

  assert.match(html, /Choose an occurrence context for child/);
  assert.match(html, /data-occurrence-path="\[&quot;u0&quot;\]"/);
  assert.match(html, /data-occurrence-path="\[&quot;u1&quot;,&quot;x&amp;y&quot;\]"/);
  assert.match(html, /top \/ u1 \/ x&amp;y/);
  assert.doesNotMatch(html, /<script>/);
});

test("occurrence chooser preserves a slash inside one canonical instance segment", () => {
  const html = renderOccurrenceChoices([
    { moduleName: "child", rootModuleName: "top", occurrencePath: ["u/escaped"] },
    { moduleName: "child", rootModuleName: "top", occurrencePath: ["other"] }
  ], "child");
  assert.match(html, /data-occurrence-path="\[&quot;u\/escaped&quot;\]"/);
});

test("occurrence chooser stays empty when there is no ambiguity", () => {
  assert.equal(renderOccurrenceChoices([], "child"), "");
  assert.equal(renderOccurrenceChoices([
    { moduleName: "child", rootModuleName: "top", occurrencePath: ["u0"] }
  ], "child"), "");
});
