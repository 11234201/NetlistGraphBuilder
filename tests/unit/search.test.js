import assert from "node:assert/strict";
import test from "node:test";
import { parseVerilog } from "../../src/parser/verilogParser.js";
import {
  buildDesignSearchIndex,
  searchDesignIndex
} from "../../src/search/designSearch.js";

const source = `module first(a, y);
input a; output y; wire internal_net;
AOI21X1HVT special_inst (.A1(a), .ZN(internal_net));
BUF output_buffer (.A(internal_net), .Z(y));
endmodule
module \\second/hier (\\long/input , result);
input \\long/input ; output result;
OA211X2HVT mapped_cell (.A1(\\long/input ), .Z(result));
endmodule`;

test("design search indexes modules, ports, nets, instances, and cell types", () => {
  const index = buildDesignSearchIndex(parseVerilog(source));

  assert.equal(searchDesignIndex(index, "first")[0].kind, "module");
  assert.equal(searchDesignIndex(index, "internal_net")[0].kind, "net");
  assert.equal(searchDesignIndex(index, "special_inst")[0].target.kind, "cell");
  assert.equal(searchDesignIndex(index, "AOI21")[0].label, "special_inst");
  assert.equal(searchDesignIndex(index, "long/input")[0].kind, "port");
});

test("design search returns cross-module context and respects limits", () => {
  const index = buildDesignSearchIndex(parseVerilog(source));
  const results = searchDesignIndex(index, "oa", 1);

  assert.equal(results.length, 1);
  assert.equal(results[0].moduleName, "second/hier");
  assert.equal(results[0].detail, "OA211X2HVT");
  assert.deepEqual(searchDesignIndex(index, "   "), []);
});
