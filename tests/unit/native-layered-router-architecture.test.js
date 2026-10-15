import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * NLR-10 architecture guard.
 *
 * The native router replaced the retired Native channel/physical-net pair and
 * must not fall back to the Simple/Adjust candidate-search policy. Both lists
 * are encoded explicitly so the guard neither over-blocks the shared geometry
 * and validation boundaries the router still needs nor under-blocks the
 * retired search path.
 */

const routerDirectory = new URL("../reference/retired_native_layered/router/", import.meta.url);
const nativeLayeredDirectory = new URL("../reference/retired_native_layered/", import.meta.url);
const layoutDirectory = new URL("../../src/layout/", import.meta.url);

// Retired by NLR-10: the old Native channel/router pair plus the Simple/Adjust
// candidate-search policy. Importing any of these reintroduces the abstraction
// the router/ pipeline exists to replace.
const FORBIDDEN_MODULES = Object.freeze([
  "channel_allocation.js",
  "physical_net_routing.js",
  "simpleRouteCandidates.js",
  "localRouteCandidates.js",
  "routeLaneCandidates.js",
  "routeScoring.js",
  "routeSearchPolicy.js",
  "channelCapacity.js",
  "simpleOrthogonalRouter.js",
  "localOrthogonalRouter.js"
]);

// Shared boundaries the native router depends on for geometry, commit and
// validation. These must stay importable.
const ALLOWED_MODULES = Object.freeze([
  "routeCandidateValidation.js",
  "orthogonalRouting.js",
  "spatialIndex.js",
  "physical_net_commit.js",
  "wireRoutes.js",
  "wireLabelPlacement.js",
  "nodeGeometry.js",
  "layoutTopology.js"
]);

// Positive dependencies: the shared boundaries the router actually consumes
// today. Losing one of these means the router re-implemented a shared rule.
const REQUIRED_IMPORTS = Object.freeze([
  "orthogonalRouting.js",
  "nodeGeometry.js",
  "spatialIndex.js"
]);

const SPECIFIER_PATTERN = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g;

async function ListRouterFiles() {
  const found = [];
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryUrl = new URL(entry.name, directory);
      if (entry.isDirectory()) {
        await walk(entryUrl);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".js")) found.push(entryUrl);
    }
  };
  await walk(routerDirectory);
  return found.sort((left, right) => left.pathname.localeCompare(right.pathname));
}

function SpecifiersOf(source) {
  const specifiers = [];
  let match = null;
  SPECIFIER_PATTERN.lastIndex = 0;
  while ((match = SPECIFIER_PATTERN.exec(source)) !== null) {
    specifiers.push(match[1] ?? match[2] ?? match[3]);
  }
  return specifiers;
}

function BasenameOf(specifier) {
  return String(specifier).split("/").pop();
}

async function Exists(url) {
  try {
    await stat(fileURLToPath(url));
    return true;
  } catch {
    return false;
  }
}

test("native router imports no retired Native or Simple/Adjust routing module", async () => {
  const files = await ListRouterFiles();
  assert.ok(files.length > 0, "expected native router source files");

  for (const fileUrl of files) {
    const source = await readFile(fileURLToPath(fileUrl), "utf8");
    for (const specifier of SpecifiersOf(source)) {
      const basename = BasenameOf(specifier);
      assert.equal(
        FORBIDDEN_MODULES.includes(basename),
        false,
        `${fileUrl.pathname} must not import forbidden module ${basename}`
      );
    }
  }
});

test("NLR-10 deleted Native channel and physical-net modules stay deleted", async () => {
  for (const name of ["channel_allocation.js", "physical_net_routing.js"]) {
    assert.equal(
      await Exists(new URL(name, nativeLayeredDirectory)),
      false,
      `expected ${name} to remain deleted after the NLR-10 cutover`
    );
  }
});

test("shared routing boundaries stay importable for the native router", async () => {
  for (const name of ALLOWED_MODULES) {
    assert.equal(
      await Exists(new URL(name, layoutDirectory)),
      true,
      `expected shared boundary ${name} to remain available`
    );
  }
});

test("native router keeps importing the shared geometry and validation boundaries", async () => {
  const files = await ListRouterFiles();
  const imported = new Set();
  for (const fileUrl of files) {
    const source = await readFile(fileURLToPath(fileUrl), "utf8");
    for (const specifier of SpecifiersOf(source)) imported.add(BasenameOf(specifier));
  }

  for (const name of REQUIRED_IMPORTS) {
    assert.equal(
      imported.has(name),
      true,
      `expected the native router to keep importing shared boundary ${name}`
    );
  }
});
