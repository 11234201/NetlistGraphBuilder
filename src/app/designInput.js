import { parseVerilog } from "../parser/verilogParser.js";

export function parseDesignSource(source) {
  const design = parseVerilog(source);
  if (design.modules.length === 0) {
    throw new Error("No module declarations found");
  }
  return design;
}
