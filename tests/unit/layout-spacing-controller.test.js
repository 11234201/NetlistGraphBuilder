import assert from "node:assert/strict";
import test from "node:test";
import { createLayoutSpacingController } from "../../src/ui/layout_spacing_controller.js";

const input = () => {
  const listeners = {};
  return { value: "", addEventListener: (type, handler) => { listeners[type] = handler; }, fire(type, value) { this.value = value; listeners[type]({ target: this }); } };
};

test("layout spacing controller binds both inputs and emits snapped commands", () => {
  const elements = {
    wireSpacingInput: input(), wireSpacingNumberInput: input(), wireSpacingValue: input(),
    cellSpacingInput: input(), cellSpacingNumberInput: input(), cellSpacingValue: input()
  };
  const spacing = { wireLanePitch: 24, cellSpacing: 40 };
  const commands = [];
  const controller = createLayoutSpacingController({
    elements,
    getSpacing: () => spacing,
    onCommit(key, value) { spacing[key] = value; commands.push([key, value]); }
  });
  elements.wireSpacingNumberInput.fire("change", "27");
  elements.cellSpacingInput.fire("input", "45");
  assert.deepEqual(commands, [["wireLanePitch", 28], ["cellSpacing", 44]]);
  assert.equal(elements.wireSpacingInput.value, "28");
  assert.equal(elements.cellSpacingNumberInput.value, "44");
  assert.equal(controller.commit("cellSpacing", ""), 44);
});
