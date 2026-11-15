import { instance, graphvizVersion } from "./graphviz_vendor.js";

let runtime;
self.onmessage = async ({ data }) => {
  try {
    if (!["json", "dot_json"].includes(data.format)) throw new Error("Unsupported Graphviz result format");
    runtime ||= instance();
    const viz = await runtime;
    const result = viz.render(data.dot, { engine: "dot", format: data.format });
    if (result.status !== "success") {
      throw new Error(result.errors.map((item) => item.message).join("\n") || "Graphviz failed");
    }
    self.postMessage({ id: data.id, result: JSON.parse(result.output), version: graphvizVersion,
      warnings: result.errors.map((item) => item.message) });
  } catch (error) {
    self.postMessage({ id: data.id, error: { name: error.name || "Error", message: error.message || String(error) } });
  }
};
