import { netlistFeature } from "../domains/netlist/netlist_feature.js";
import { createDomainRegistry } from "./domain_registry.js";

export function createDefaultDomainRegistry() {
  return createDomainRegistry([netlistFeature]);
}
