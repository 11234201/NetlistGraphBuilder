import { createDefaultDomainRegistry } from "../bootstrap/default_domains.js";

export function importDesignSource(source, context = {}, registry = createDefaultDomainRegistry()) {
  const feature = registry.require(context.domainId || "netlist");
  return feature.importSource({ name: context.name || "Verilog", text: source }, context);
}

export function parseDesignSource(source, context = {}, registry) {
  return importDesignSource(source, context, registry).model;
}
