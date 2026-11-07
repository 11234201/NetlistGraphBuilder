import { layoutGraph } from "./elk_native/index.js";

self.onmessage = async ({ data }) => {
  try {
    const result = await layoutGraph(data.input, data.options);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: { name: error.name, message: error.message, diagnostic: error.diagnostic } });
  }
};
