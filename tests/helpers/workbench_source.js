import { readFile, readdir } from "node:fs/promises";

// Architecture source-contract checks span responsibilities formerly in main.
// Keep each module intact: never rewrite dependency qualifiers or reconstruct
// executable function bodies, because behavior tests instantiate real factories.
export async function readWorkbenchSource() {
  const root = new URL("../../src/app/", import.meta.url);
  const files = ["main.js", ...(await readdir(root)).filter((name) => name.endsWith("_controller.js")).sort()];
  return (await Promise.all(files.map(async (name) =>
    `\n/* module: ${name} */\n${await readFile(new URL(name, root), "utf8")}`))).join("\n");
}
