import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("contracts stay independent and the Netlist adapter has one explicit legacy app dependency", () => {
  const contractDir = join(projectRoot, "src", "contracts");
  for (const name of readdirSync(contractDir)) {
    if (extname(name) !== ".js") continue;
    const source = readFileSync(join(contractDir, name), "utf8");
    assert.doesNotMatch(source, /from\s+["']\.\.\//, `${name} must not import implementation layers`);
  }

  const adapter = readFileSync(join(projectRoot, "src", "domains", "netlist", "netlist_feature.js"), "utf8");
  const legacyImports = [...adapter.matchAll(/from\s+["'](\.\.\/\.\.\/app\/[^"']+)["']/g)].map((match) => match[1]);
  assert.deepEqual(legacyImports, ["../../app/graphWorkspace.js"]);
});
