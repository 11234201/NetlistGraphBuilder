import { readdir } from "node:fs/promises";

const unitDirectory = new URL("../tests/unit/", import.meta.url);
const testFiles = (await readdir(unitDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

for (const testFile of testFiles) {
  await import(new URL(testFile, unitDirectory));
}
