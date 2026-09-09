import { netlistFeature } from "../domains/netlist/netlist_feature.js";

export function importDesignSource(source, context = {}) {
  return netlistFeature.importSource({ name: context.name || "Verilog", text: source }, context);
}

export function parseDesignSource(source, context = {}) {
  return importDesignSource(source, context).model;
}
