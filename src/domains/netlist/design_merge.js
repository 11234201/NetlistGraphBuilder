import { createDocumentEnvelope, normalizeSourceInput } from "../../contracts/document.js";
import { parseVerilog } from "../../parser/verilogParser.js";
import { NETLIST_DOMAIN_ID, netlistFeature } from "./netlist_feature.js";

function stripDirectory(name) {
  const text = String(name || "").trim();
  if (!text) return "";
  const parts = text.split(/[\\/]/);
  return parts[parts.length - 1] || text;
}

function makeSourceLabels(entries) {
  const used = new Set();
  const byBase = new Map();
  return entries.map((entry, index) => {
    const base = stripDirectory(entry.name) || `design-${index + 1}.v`;
    const counter = byBase.get(base) || { count: 0, nextSuffix: 2 };
    counter.count += 1;
    // Persisted module and occurrence IDs use the original per-basename numbering.
    const moduleKeyLabel = counter.count === 1 ? base : `${base} (${counter.count})`;
    let label = base;
    while (used.has(label)) {
      label = `${base} (${counter.nextSuffix})`;
      counter.nextSuffix += 1;
    }
    used.add(label);
    byBase.set(base, counter);
    return { label, moduleKeyLabel };
  });
}

function makeUniqueModuleName(baseName, sourceLabel, usedNames) {
  const candidate = `${baseName} [${sourceLabel}]`;
  if (!usedNames.has(candidate)) return candidate;
  let suffix = 2;
  while (usedNames.has(`${candidate} #${suffix}`)) suffix += 1;
  return `${candidate} #${suffix}`;
}

export function formatMergedSourceLabel(sourceEntries = []) {
  return formatSourceLabels(makeSourceLabels(sourceEntries));
}

function formatSourceLabels(labels) {
  if (labels.length === 0) return "Verilog";
  if (labels.length === 1) return labels[0].label;
  if (labels.length === 2) return `${labels[0].label} + ${labels[1].label}`;
  return `${labels[0].label} + ${labels.length - 1} files`;
}

/**
 * Parses and merges one or more structural Verilog source entries into a single
 * netlist document envelope while preserving `originalName` and `sourceFile`
 * metadata and only disambiguating colliding module names across files.
 */
export function mergeNetlistSources(sourceEntries = [], context = {}) {
  const entries = (Array.isArray(sourceEntries) ? sourceEntries : [sourceEntries])
    .filter((entry) => entry && typeof entry.text === "string");
  if (entries.length === 0) {
    throw new Error("At least one structural Verilog source is required");
  }

  const normalized = entries.map((entry) => normalizeSourceInput({
    name: entry.name || "Verilog",
    text: entry.text,
    mediaType: entry.mediaType || "text/plain"
  }));
  const sourceLabels = makeSourceLabels(normalized);

  if (normalized.length === 1) {
    const doc = netlistFeature.importSource(
      { ...normalized[0], name: sourceLabels[0].label },
      context
    );
    return doc;
  }

  const parsedGroups = normalized.map((entry, index) => {
    const { label: sourceLabel, moduleKeyLabel } = sourceLabels[index];
    const parsed = parseVerilog(entry.text);
    if (!parsed.modules || parsed.modules.length === 0) {
      throw new Error(`No module declarations found in ${sourceLabel}`);
    }
    return { entry, sourceLabel, moduleKeyLabel, parsed };
  });

  const nameCounts = new Map();
  for (const group of parsedGroups) {
    for (const module of group.parsed.modules) {
      nameCounts.set(module.name, (nameCounts.get(module.name) || 0) + 1);
    }
  }

  const usedNames = new Set();
  const mergedModules = [];
  const mergedDiagnostics = [];
  let totalSize = 0;

  for (const { entry, sourceLabel, moduleKeyLabel, parsed } of parsedGroups) {
    totalSize += entry.text.length;
    for (const diag of parsed.diagnostics || []) {
      mergedDiagnostics.push({ ...diag, sourceFile: diag.sourceFile || sourceLabel });
    }
    for (const module of parsed.modules) {
      const rawName = module.name;
      const rawDisplayName = module.displayName || rawName;
      const collides = (nameCounts.get(rawName) || 0) > 1 || usedNames.has(rawName);
      module.originalName = rawName;
      module.sourceFile = sourceLabel;
      if (collides) {
        module.name = makeUniqueModuleName(rawName, moduleKeyLabel, usedNames);
        module.displayName = `${rawDisplayName} [${sourceLabel}]`;
      }
      usedNames.add(module.name);
      mergedModules.push(module);
    }
  }

  const combinedName = formatSourceLabels(sourceLabels);
  const documentId = context.documentId || `netlist:${encodeURIComponent(combinedName)}`;

  return createDocumentEnvelope({
    documentId,
    domainId: NETLIST_DOMAIN_ID,
    sourceRevision: context.sourceRevision || 1,
    source: {
      name: combinedName,
      kind: "text",
      mediaType: "text/plain",
      size: totalSize
    },
    model: {
      modules: mergedModules,
      diagnostics: mergedDiagnostics
    },
    diagnostics: mergedDiagnostics
  });
}
