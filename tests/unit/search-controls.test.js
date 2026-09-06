import test from "node:test";
import assert from "node:assert/strict";
import { createSearchControls } from "../../src/ui/searchControls.js";
import { buildDesignSearchIndex } from "../../src/search/designSearch.js";
import { parseVerilog } from "../../src/parser/verilogParser.js";

test("search controls dispatch Enter and explicit Add and clear persisted query", () => {
  const index = buildDesignSearchIndex(parseVerilog("module top(a,y); input a; output y; BUF unique_cell (.A(a),.Z(y)); endmodule"));
  const elements = {
    searchInput: { value: "unique_cell" },
    searchResults: { innerHTML: "", hidden: true, querySelector: () => null },
    searchClearButton: {}
  };
  const actions = [];
  let query;
  const controls = createSearchControls({ elements, getIndex: () => index,
    onActivate: (result) => actions.push(["activate", result.label]),
    onAdd: (result) => actions.push(["add", result.label]),
    onChange: (state) => { query = state.searchQuery; }
  });
  controls.handleSearchInput();
  assert.equal(elements.searchResults.hidden, false);
  controls.handleSearchKeydown({ key: "Enter", preventDefault() {} });
  controls.handleSearchResultClick({ target: { closest: () => ({ dataset: { searchAddIndex: "0" } }) } });
  assert.deepEqual(actions, [["activate", "unique_cell"], ["add", "unique_cell"]]);
  controls.clearSearch();
  assert.equal(query, "");
  assert.equal(elements.searchResults.hidden, true);
  controls.handleSearchKeydown({ key: "Enter", preventDefault() {} });
  assert.equal(actions.length, 2);
});
