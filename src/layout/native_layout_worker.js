import { layoutGraph } from "./anchor_layered/index.js";

import { serializeWorkerError } from "../foundation/worker_error.js";

self.onmessage = async ({ data }) => {
  try {
    const result = await layoutGraph(data.input, data.options);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: serializeWorkerError(error) });
  }
};
