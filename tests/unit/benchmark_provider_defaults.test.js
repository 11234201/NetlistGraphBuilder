import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";

const execute = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "ngb-benchmark-provider-"));
await writeFile(path.join(fixtureRoot, "tiny_mapped.v"), `module tc(input a, output y);
wire n;
BUF_X1 u0 (.A(a), .Z(n));
BUF_X1 u1 (.A(n), .Z(y));
endmodule
`);
after(() => rm(fixtureRoot, { recursive: true, force: true }));

async function run(script, overrides = {}) {
  const env = { ...process.env };
  delete env.BENCHMARK_PROVIDER;
  delete env.MAPPED_BENCHMARK_PROVIDER;
  Object.assign(env, {
    BENCHMARK_SIZES: "4", BENCHMARK_RUNS: "2",
    BENCHMARK_WORKSPACE_SIZES: "4", BENCHMARK_INTERACTION_SIZES: "4",
    MAPPED_CASE_ROOT: fixtureRoot, EXPECTED_MAPPED_CASES: "1", MAPPED_BENCHMARK_TIMEOUT_MS: "15000",
    ...overrides
  });
  const { stdout } = await execute(process.execPath, [path.join(projectRoot, "tools", script)], {
    cwd: projectRoot, env, timeout: 20000
  });
  const records = stdout.trim().split(/\r?\n/).filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  assert.equal(records.length, 1, stdout);
  assert.doesNotMatch(stdout, /NaN|requires synchronous|must be synchronous/);
  return records[0];
}

for (const providerId of [DEFAULT_LAYOUT_PROVIDER_ID, "simple-layered"]) {
  const override = providerId === DEFAULT_LAYOUT_PROVIDER_ID ? {} : { BENCHMARK_PROVIDER: providerId };
  for (const script of ["benchmark-large.mjs", "benchmark-mapped-cases.mjs", "benchmark-workspace-cache.mjs", "benchmark-interaction.mjs"]) {
    test(`${script} completes with ${providerId === DEFAULT_LAYOUT_PROVIDER_ID ? "the async product default" : "an explicit Simple provider"}`, async () => {
      const result = await run(script, override);
      assert.equal(result.providerId, providerId);
      if (script === "benchmark-large.mjs") {
        assert.equal(result.fullNode, true);
        assert.deepEqual(result.phases.map((phase) => phase.cells), [4]);
      } else if (script === "benchmark-mapped-cases.mjs") {
        assert.equal(result.cases, 1);
        assert.equal(result.successful, 1);
        assert.equal(result.failed, 0);
        assert.equal(result.routed, 1);
      } else {
        assert.equal(result.cells, 4);
        assert.ok(result.cache.hits >= 2, "warm work must observe the completed cold cache entry");
      }
      for (const [key, value] of Object.entries(result)) {
        if (key.endsWith("Ms")) assert.ok(Number.isFinite(value) && value >= 0, `${key}=${value}`);
      }
    });
  }
}

test("mapped benchmark retains its specific provider override ahead of the general override", async () => {
  const result = await run("benchmark-mapped-cases.mjs", {
    BENCHMARK_PROVIDER: DEFAULT_LAYOUT_PROVIDER_ID,
    MAPPED_BENCHMARK_PROVIDER: "simple-layered"
  });
  assert.equal(result.providerId, "simple-layered");
  assert.equal(result.successful, 1);
});
