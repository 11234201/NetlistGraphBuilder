import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DEFAULT_LAYOUT_PROVIDER_ID } from "../../src/layout/providerDefaults.js";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("mapped runner and standalone worker follow the product default and preserve explicit overrides", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ngb-mapped-provider-"));
  const fixture = path.join(directory, "tiny_mapped.v");
  try {
    await writeFile(fixture, "module tiny(input a, output y); BUF_X1 u(.A(a), .Z(y)); endmodule\n");
    for (const override of [undefined, "simple-layered"]) {
      const env = { ...process.env, MAPPED_CASE_ROOT: directory, EXPECTED_MAPPED_CASES: "1",
        MAPPED_CASE_NO_COLLAPSE: "1", MAPPED_HARD_INVARIANTS: "1", MAPPED_CASE_TIMEOUT_MS: "45000" };
      delete env.MAPPED_CASE_PROVIDER;
      if (override) env.MAPPED_CASE_PROVIDER = override;
      const expected = override || DEFAULT_LAYOUT_PROVIDER_ID;
      const run = (script, args = []) => {
        const result = spawnSync(process.execPath, [script, ...args], {
          cwd: root, env, encoding: "utf8", timeout: 15000, windowsHide: true
        });
        assert.equal(result.error, undefined, result.error?.message);
        assert.equal(result.status, 0, result.stderr + result.stdout);
        return result.stdout;
      };
      const metrics = JSON.parse(run("tools/test-one-mapped-case.mjs", [fixture, "--no-collapse", "--hard"]));
      assert.equal(metrics.providerId, expected);
      assert.equal(metrics.routedEdges, metrics.edges);
      assert.equal(metrics.violations, 0);
      const batch = run("tools/test-mapped-cases.mjs", ["--hard"]);
      assert.ok(batch.includes(`mapped configuration: provider=${expected}, cases=1, timeoutMs=45000, hardInvariants=true, noCollapse=true`));
      assert.ok(batch.includes("mapped cases=1, failed=0, violations=0/0"));
      assert.ok(batch.includes(`provider=${expected}, noCollapse=true`));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
