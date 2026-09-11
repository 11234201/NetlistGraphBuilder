import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("contracts and Netlist domain stay independent from application implementations", () => {
  const contractDir = join(projectRoot, "src", "contracts");
  for (const name of readdirSync(contractDir)) {
    if (extname(name) !== ".js") continue;
    const source = readFileSync(join(contractDir, name), "utf8");
    assert.doesNotMatch(source, /from\s+["']\.\.\//, `${name} must not import implementation layers`);
  }

  const adapter = readFileSync(join(projectRoot, "src", "domains", "netlist", "netlist_feature.js"), "utf8");
  const legacyImports = [...adapter.matchAll(/from\s+["'](\.\.\/\.\.\/app\/[^"']+)["']/g)].map((match) => match[1]);
  assert.deepEqual(legacyImports, []);
});

test("shared application and layout layers do not import Netlist-only implementations", () => {
  const forbidden = /from\s+["']\.\.\/(?:domains\/netlist|infer|netlist|parser|timing)\//;
  for (const directory of ["application", "layout"]) {
    const absoluteDirectory = join(projectRoot, "src", directory);
    for (const name of readdirSync(absoluteDirectory)) {
      if (extname(name) !== ".js") continue;
      const source = readFileSync(join(absoluteDirectory, name), "utf8");
      assert.doesNotMatch(source, forbidden, `${directory}/${name} must remain domain-neutral`);
    }
  }
  const layoutFiles = readdirSync(join(projectRoot, "src", "layout"))
    .filter((name) => extname(name) === ".js")
    .map((name) => readFileSync(join(projectRoot, "src", "layout", name), "utf8"))
    .join("\n");
  assert.doesNotMatch(layoutFiles, /cellPinDirections|netlist-layout-golden/);
});

test("shared layout and renderer do not interpret Netlist inference or parser references", () => {
  for (const relativePath of ["src/layout/nodeGeometry.js", "src/layout/nodeSpacing.js", "src/render/svgRenderer.js"]) {
    const source = readFileSync(join(projectRoot, ...relativePath.split("/")), "utf8");
    assert.doesNotMatch(source, /infer\/defaultCellRules|node\.ref/, `${relativePath} must consume presentation fields`);
  }
  const renderer = readFileSync(join(projectRoot, "src", "render", "svgRenderer.js"), "utf8");
  const workspace = readFileSync(join(projectRoot, "src", "app", "moduleWorkspace.js"), "utf8");
  assert.doesNotMatch(renderer, /domains\/netlist/, "shared renderer must not import Netlist presentation");
  assert.match(workspace, /createNetlistScene/, "Netlist workspace must use its domain scene facade");
  const benchmark = readFileSync(join(projectRoot, "tools", "benchmark-large.mjs"), "utf8");
  assert.match(benchmark, /domains\/netlist\/netlist_scene\.js/, "Netlist benchmark must inject domain presentation");
  assert.doesNotMatch(benchmark, /from\s+["']\.\.\/src\/render\/svgRenderer\.js["']/);
});
