import { readFileSync, readdirSync } from "node:fs";
import { posix, relative, sep } from "node:path";
import acorn from "./vendor/acorn/acorn.cjs";

export function readModuleSources(root) {
  const sources = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:m?js)$/.test(entry.name)) {
        sources.set(relative(root, path).split(sep).join("/"), readFileSync(path, "utf8"));
      }
    }
  }
  visit(root);
  return sources;
}

export function buildModuleGraph(sources) {
  const graph = new Map([...sources.keys()].sort().map((name) => [name, []]));
  const diagnostics = [];
  for (const [name, source] of sources) {
    let ast;
    try { ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true }); }
    catch (error) { diagnostics.push(`${name}: ${error.message}`); continue; }
    const workerAliases = new Set(["Worker", "SharedWorker"]);
    walk(ast, (node) => {
      if (node.type !== "VariableDeclarator" || node.id?.type !== "Identifier") return;
      if (isWorkerConstructor(node.init, workerAliases)) workerAliases.add(node.id.name);
    });
    function dependency(node, expression, kind) {
      const specifier = literalString(expression);
      if (specifier === null) {
        diagnostics.push(`${name}:${node.loc.start.line}: ${kind} must use a statically resolvable string`);
        return;
      }
      const rooted = specifier.startsWith("/src/");
      if (!specifier.startsWith(".") && !rooted) {
        diagnostics.push(`${name}:${node.loc.start.line}: non-local module ${specifier}`);
        return;
      }
      let target;
      try {
        const path = decodeURIComponent(specifier.split(/[?#]/)[0]);
        target = rooted ? posix.normalize(path.slice(5)) : posix.normalize(posix.join(posix.dirname(name), path));
      }
      catch { diagnostics.push(`${name}:${node.loc.start.line}: invalid module URL ${specifier}`); return; }
      if (!graph.has(target)) {
        diagnostics.push(`${name}:${node.loc.start.line}: unresolved module ${specifier} -> ${target}`);
        return;
      }
      graph.get(name).push({ target, kind, line: node.loc.start.line, specifier });
    }
    walk(ast, (node) => {
      if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) && node.source) {
        dependency(node, node.source, node.type);
      } else if (node.type === "ImportExpression") {
        dependency(node, node.source, "dynamic import");
      } else if (node.type === "NewExpression" &&
          isWorkerConstructor(node.callee, workerAliases)) {
        const entry = node.arguments[0];
        if (entry?.type === "NewExpression" && entry.callee.name === "URL") {
          if (!isImportMetaUrl(entry.arguments[1])) diagnostics.push(`${name}:${node.loc.start.line}: worker URL must be relative to import.meta.url`);
          else dependency(node, entry.arguments[0], "worker entry");
        } else if (literalString(entry)?.startsWith(".")) {
          diagnostics.push(`${name}:${node.loc.start.line}: relative worker entry must use new URL(path, import.meta.url)`);
        } else dependency(node, entry, "worker entry");
      }
    });
    graph.get(name).sort((a, b) => a.target.localeCompare(b.target) || a.line - b.line);
  }
  return { graph, diagnostics: diagnostics.sort() };
}

export function findModuleCycles(graph) {
  const visited = new Set(), active = new Map(), stack = [], cycles = [];
  function visit(name) {
    visited.add(name);
    active.set(name, stack.length);
    stack.push(name);
    for (const { target } of graph.get(name)) {
      if (active.has(target)) cycles.push([...stack.slice(active.get(target)), target]);
      else if (!visited.has(target)) visit(target);
    }
    stack.pop();
    active.delete(name);
  }
  for (const name of [...graph.keys()].sort()) if (!visited.has(name)) visit(name);
  return cycles;
}

export function findBoundaryViolations(graph) {
  const uiAppCompatibilityModules = new Set([
    "app/processLog.js",
    "app/quickInput.js"
  ]);
  const layerDependencies = {
    contracts: ["contracts", "foundation"],
    foundation: ["foundation"],
    application: ["application", "contracts", "foundation", "diagram", "layout", "render"],
    layout: ["layout", "contracts", "foundation"],
    render: ["render", "layout", "contracts", "foundation"],
    diagram: ["diagram", "layout", "contracts", "foundation"],
    domains: ["domains", "infer", "netlist", "parser", "search", "analysis", "timing", "layout", "render", "contracts", "foundation"],
    parser: ["parser", "netlist", "contracts", "foundation"],
    netlist: ["netlist", "infer", "contracts", "foundation"],
    infer: ["infer", "contracts", "foundation"],
    analysis: ["analysis", "netlist", "infer", "contracts", "foundation"],
    search: ["search", "netlist", "contracts", "foundation"],
    timing: ["timing", "contracts", "foundation"],
    persistence: ["persistence", "infer", "contracts", "foundation"],
    platform: ["platform", "contracts", "foundation"],
    ui: ["ui", "layout", "infer", "search", "timing", "contracts", "foundation"],
    bootstrap: ["bootstrap", "domains", "contracts", "foundation"]
  };
  const violations = [];
  for (const [source, edges] of graph) {
    const owner = source.split("/")[0];
    for (const edge of edges) {
      const layer = edge.target.split("/")[0];
      let forbidden = edge.target === "app/main.js";
      if (owner === "app" && edge.target.startsWith("app/")) {
        forbidden ||= appModuleRank(source) < appModuleRank(edge.target);
      }
      if (owner === "ui" && layer === "app") forbidden ||= !uiAppCompatibilityModules.has(edge.target);
      else if (owner !== "app") forbidden ||= !Object.hasOwn(layerDependencies, owner) || !layerDependencies[owner].includes(layer);
      if (uiAppCompatibilityModules.has(source)) {
        forbidden ||= !["contracts", "foundation"].includes(layer);
      }
      if (forbidden) violations.push(`${source}:${edge.line} --${edge.kind}--> ${edge.target}`);
    }
  }
  return violations;
}

function appModuleRank(name) {
  if (["app/main.js", "app/workbench_controllers.js"].includes(name)) return 3;
  if (/_controller\.js$/.test(name)) return 2;
  if (new Set([
    "app/appState.js", "app/compareWorkspace.js", "app/layoutGoldenImport.js", "app/moduleWorkspace.js",
    "app/sessionState.js", "app/startupController.js", "app/viewHistory.js", "app/viewHistoryTransaction.js",
    "app/workspace_identity.js", "app/workspace_inputs.js", "app/compare_view_session_bridge.js",
    "app/single_view_session_bridge.js"
  ]).has(name)) return 1;
  return 0;
}

function isWorkerConstructor(node, aliases) {
  if (node?.type === "Identifier") return aliases.has(node.name);
  return node?.type === "MemberExpression" && !node.computed &&
    ["globalThis", "window"].includes(node.object?.name) && ["Worker", "SharedWorker"].includes(node.property?.name);
}

function literalString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

function isImportMetaUrl(node) {
  return node?.type === "MemberExpression" && !node.computed && node.property.name === "url" &&
    node.object.type === "MetaProperty" && node.object.meta.name === "import" && node.object.property.name === "meta";
}

function walk(node, callback) {
  if (!node || typeof node !== "object") return;
  if (node.type) callback(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => walk(item, callback));
    else if (value && typeof value === "object") walk(value, callback);
  }
}
