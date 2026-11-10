// Demonstrate that the real-input checker rejects a wrong library, direction and net bit.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const [manifestPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error("Usage: node tools/test_liberty_synthesis_controls.mjs manifest.json new-output-directory");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.notEqual(manifest.complete, false);
const original = manifest.cases.find((entry) => entry.status === "passed");
assert.ok(original);
const other = manifest.libraries.find((entry) => entry.name !== original.library);
assert.ok(other, "Need two distinct libraries for the wrong-library control");
const output = resolve(outputPath);
await mkdir(output); // Preserve earlier evidence; never overwrite an existing control run.
const design = JSON.parse(await readFile(original.design, "utf8"));
const [instance, cell] = Object.entries(design.modules[manifest.top].cells)
  .find(([, cell]) => Object.entries(cell.port_directions).some(([pin, direction]) => direction === "input" && cell.connections[pin]?.length));
const pin = Object.keys(cell.port_directions).find((name) => cell.port_directions[name] === "input" && cell.connections[name]?.length);
const cases = [{ ...original, name: "wrong_library", library: other.name }];
for (const control of ["wrong_direction", "wrong_bit"]) {
  const altered = structuredClone(design);
  const alteredCell = altered.modules[manifest.top].cells[instance];
  if (control === "wrong_direction") alteredCell.port_directions[pin] = "output";
  else alteredCell.connections[pin][0] = "deliberately_invalid_net_bit";
  const text = JSON.stringify(altered), path = join(output, `${control}.json`);
  await writeFile(path, text);
  cases.push({ ...original, name: control, design: path, designSha256: createHash("sha256").update(text).digest("hex") });
}
const input = join(output, "manifest.json"), report = join(output, "rejections.json");
await writeFile(input, JSON.stringify({ ...manifest, cases, expectedCases: cases.length, complete: true }, null, 2));
const checker = fileURLToPath(new URL("./test_liberty_synthesis.mjs", import.meta.url));
const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [checker, input, report], { stdio: "inherit" });
  child.on("error", reject); child.on("exit", resolve);
});
assert.equal(exitCode, 1, "Invalid inputs must cause a failed checker exit");
const result = JSON.parse(await readFile(report, "utf8"));
assert.equal(result.failed, 3);
const reasons = Object.fromEntries(result.results.map((entry) => [entry.name, entry.error]));
assert.match(reasons.wrong_library, /Graph diagnostics/);
assert.match(reasons.wrong_direction, /Non-input edge target|direction/);
assert.match(reasons.wrong_bit, /different Yosys net bits|connection bits/);
await writeFile(join(output, "controls_report.json"), JSON.stringify({ controls: 3, rejected: 3, reasons }, null, 2) + "\n");
console.log(JSON.stringify({ controls: 3, rejected: 3, status: "passed" }));
