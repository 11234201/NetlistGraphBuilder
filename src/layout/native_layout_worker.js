import { layoutGraph } from "./anchor_layered/index.js";

self.onmessage = async ({ data }) => {
  try {
    const result = await layoutGraph(data.input, data.options);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: { name: error.name, message: error.message, stack: error.stack, diagnostic: error.diagnostic } });
  }
};
