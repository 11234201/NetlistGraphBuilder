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
    const workerConstructors = findWorkerConstructors(ast);
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
          workerConstructors.has(node)) {
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

function findWorkerConstructors(ast) {
  const constructors = new WeakSet();
  const GLOBAL_OBJECT = Symbol("global-object");
  const root = {
    parent: null,
    functionScope: null,
    bindings: new Map([
      ["Worker", true], ["SharedWorker", true],
      ["window", GLOBAL_OBJECT], ["globalThis", GLOBAL_OBJECT]
    ])
  };
  root.functionScope = root;
  visit(ast, root);
  return constructors;

  function visit(node, scope, conditional = false) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach((item) => visit(item, scope, conditional)); return; }
    if (node.type === "Program") {
      predeclareStatements(node.body, scope);
      collectVarDeclarations(node, scope);
      visit(node.body, scope, conditional);
      return;
    }
    if (node.type === "BlockStatement") {
      const block = { parent: scope, functionScope: scope.functionScope, bindings: new Map() };
      predeclareStatements(node.body, block);
      visit(node.body, block, conditional);
      return;
    }
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) {
      const functionScope = { parent: scope, functionScope: null, bindings: new Map() };
      functionScope.functionScope = functionScope;
      if (node.type === "FunctionExpression" && node.id) declarePattern(node.id, functionScope, false);
      node.params.forEach((parameter) => declarePattern(parameter, functionScope, false));
      collectVarDeclarations(node.body, functionScope);
      visit(node.body, functionScope, false);
      return;
    }
    if (node.type === "ImportDeclaration") {
      node.specifiers.forEach((specifier) => declarePattern(specifier.local, scope, false));
      return;
    }
    if (node.type === "VariableDeclaration") {
      for (const declaration of node.declarations) {
        visit(declaration.init, scope, conditional);
        const declarationScope = node.kind === "var" ? scope.functionScope : scope;
        assignPattern(declaration.id, declarationScope, resolvesWorker(declaration.init, scope), conditional);
      }
      return;
    }
    if (node.type === "AssignmentExpression") {
      visit(node.right, scope, conditional);
      if (node.operator === "=" && node.left.type === "Identifier") {
        assignBinding(node.left.name, resolvesWorker(node.right, scope), scope, conditional);
      } else visit(node.left, scope, conditional);
      return;
    }
    if (node.type === "IfStatement") {
      visit(node.test, scope, conditional);
      if (node.test.type === "Literal" && node.test.value === false) {
        visit(node.alternate, scope, conditional);
      } else if (node.test.type === "Literal" && node.test.value === true) {
        visit(node.consequent, scope, conditional);
      } else {
        visit(node.consequent, scope, true);
        visit(node.alternate, scope, true);
      }
      return;
    }
    if (node.type === "ConditionalExpression") {
      visit(node.test, scope, conditional);
      visit(node.consequent, scope, true);
      visit(node.alternate, scope, true);
      return;
    }
    if (node.type === "CatchClause") {
      const catchScope = { parent: scope, functionScope: scope.functionScope, bindings: new Map() };
      declarePattern(node.param, catchScope, false);
      visit(node.body, catchScope, conditional);
      return;
    }
    if (node.type === "NewExpression" && resolvesWorker(node.callee, scope)) constructors.add(node);
    for (const [key, value] of Object.entries(node)) {
      if (["type", "start", "end", "loc"].includes(key)) continue;
      const childConditional = conditional || ["WhileStatement", "DoWhileStatement", "ForStatement", "ForInStatement", "ForOfStatement"].includes(node.type);
      visit(value, scope, childConditional);
    }
  }

  function resolvesWorker(node, scope) {
    if (node?.type === "Identifier") return resolveBinding(node.name, scope) === true;
    if (node?.type !== "MemberExpression" || resolveBinding(node.object?.name, scope) !== GLOBAL_OBJECT) return false;
    const property = node.computed ? literalString(node.property) : node.property?.name;
    return ["Worker", "SharedWorker"].includes(property);
  }

  function resolveBinding(name, scope) {
    for (let current = scope; current; current = current.parent) {
      if (current.bindings.has(name)) return current.bindings.get(name);
    }
    return false;
  }

  function assignBinding(name, value, scope, conditional = false) {
    for (let current = scope; current; current = current.parent) {
      if (current.bindings.has(name)) {
        current.bindings.set(name, conditional ? current.bindings.get(name) === true || value === true : value);
        return;
      }
    }
    scope.bindings.set(name, conditional ? value === true : value);
  }

  function assignPattern(pattern, scope, value, conditional) {
    if (!pattern) return;
    if (pattern.type === "Identifier") { assignBinding(pattern.name, value, scope, conditional); return; }
    if (pattern.type === "RestElement") { assignPattern(pattern.argument, scope, false, conditional); return; }
    if (pattern.type === "AssignmentPattern") { assignPattern(pattern.left, scope, false, conditional); return; }
    if (pattern.type === "ArrayPattern") pattern.elements.forEach((item) => assignPattern(item, scope, false, conditional));
    if (pattern.type === "ObjectPattern") pattern.properties.forEach((property) =>
      assignPattern(property.type === "RestElement" ? property.argument : property.value, scope, false, conditional));
  }

  function declarePattern(pattern, scope, value) {
    if (!pattern) return;
    if (pattern.type === "Identifier") { scope.bindings.set(pattern.name, value); return; }
    if (pattern.type === "RestElement") { declarePattern(pattern.argument, scope, false); return; }
    if (pattern.type === "AssignmentPattern") { declarePattern(pattern.left, scope, false); return; }
    if (pattern.type === "ArrayPattern") pattern.elements.forEach((item) => declarePattern(item, scope, false));
    if (pattern.type === "ObjectPattern") pattern.properties.forEach((property) =>
      declarePattern(property.type === "RestElement" ? property.argument : property.value, scope, false));
  }

  function predeclareStatements(statements, scope) {
    for (const statement of statements || []) {
      if (statement.type === "ImportDeclaration") {
        statement.specifiers.forEach((specifier) => declarePattern(specifier.local, scope, false));
      } else if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
        declarePattern(statement.id, scope, false);
      } else if (statement.type === "VariableDeclaration" && statement.kind !== "var") {
        statement.declarations.forEach((declaration) => declarePattern(declaration.id, scope, false));
      }
    }
  }

  function collectVarDeclarations(node, functionScope) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach((item) => collectVarDeclarations(item, functionScope)); return; }
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) return;
    if (node.type === "VariableDeclaration" && node.kind === "var") {
      node.declarations.forEach((declaration) => declarePattern(declaration.id, functionScope, false));
    }
    for (const [key, value] of Object.entries(node)) {
      if (["type", "start", "end", "loc"].includes(key)) continue;
      collectVarDeclarations(value, functionScope);
    }
  }
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
