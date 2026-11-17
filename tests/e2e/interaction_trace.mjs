import { writeFile } from "node:fs/promises";

// Opt-in diagnostic runs only. Do not mix traced latency with unprofiled runs.
export async function startInteractionTrace(cdp, path) {
  await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline.stack", transferMode: "ReturnAsStream" });
  return async () => {
    const complete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
    await cdp.send("Tracing.end");
    const { stream } = await complete;
    let json = "";
    try {
      for (;;) {
        const part = await cdp.send("IO.read", { handle: stream });
        json += part.base64Encoded ? Buffer.from(part.data, "base64").toString("utf8") : part.data;
        if (part.eof) break;
      }
    } finally { await cdp.send("IO.close", { handle: stream }); }
    await writeFile(path, json);
    const phases = {};
    for (const event of JSON.parse(json).traceEvents) {
      if (event.ph !== "X" || !["Layout", "Paint", "UpdateLayoutTree", "CompositeLayers"].includes(event.name)) continue;
      const phase = phases[event.name] ||= { count: 0, totalMs: 0, maxMs: 0 };
      phase.count++; phase.totalMs += event.dur / 1000; phase.maxMs = Math.max(phase.maxMs, event.dur / 1000);
      const stack = event.args?.beginData?.stackTrace;
      if (stack?.length) {
        const key = stack.map((frame) => `${frame.functionName} (${frame.url}:${frame.lineNumber})`).join(" <- ");
        phase.forcedBy ||= {};
        phase.forcedBy[key] = (phase.forcedBy[key] || 0) + event.dur / 1000;
      }
    }
    return phases;
  };
}
