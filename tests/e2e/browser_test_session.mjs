import { spawn } from "node:child_process";

export async function withBrowserTestTimeout(action, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally { clearTimeout(timer); }
}

export function waitForBrowserTestServer(server, timeoutMs = 30000) {
  let output = "";
  let onData, onError, onExit;
  const ready = new Promise((resolve, reject) => {
    onData = (chunk) => {
      output += chunk;
      let end;
      while ((end = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, end);
        output = output.slice(end + 1);
        try { const record = JSON.parse(line); if (record.event === "ready") resolve(record.url); } catch {}
      }
    };
    onError = reject;
    onExit = (code) => reject(new Error(`Browser test server exited before ready (${code})`));
    server.stdout?.on("data", onData);
    server.once("error", onError);
    server.once("exit", onExit);
  });
  return withBrowserTestTimeout(() => ready, timeoutMs, "Browser test server startup").finally(() => {
    server.stdout?.off("data", onData);
    server.off("error", onError);
    server.off("exit", onExit);
  });
}

async function stopServer(server, timeoutMs) {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  let onExit, onError;
  const exited = new Promise((resolve) => {
    onExit = resolve;
    server.once("exit", onExit);
  });
  const failed = new Promise((_, reject) => { onError = reject; server.on("error", onError); });
  try {
    server.kill();
    await withBrowserTestTimeout(() => Promise.race([exited, failed]), timeoutMs, "Browser test server shutdown");
  } catch (error) {
    // Only this harness's ChildProcess is targeted. A forced shutdown remains a
    // test failure, even if the process eventually exits.
    server.kill("SIGKILL");
    try { await withBrowserTestTimeout(() => exited, timeoutMs, "Forced server shutdown"); }
    catch (forcedError) { throw new AggregateError([error, forcedError], "Server did not exit after forced shutdown"); }
    throw error;
  } finally {
    server.off("exit", onExit);
    server.off("error", onError);
  }
}

export async function closeBrowserTestResources({ browser, server }, timeoutMs = 10000) {
  // Closing Chrome can wait on the OS indefinitely; it must never prevent the
  // independent HTTP server from being stopped or turn partial success green.
  const results = await Promise.allSettled([
    withBrowserTestTimeout(() => browser?.close(), timeoutMs, "Browser shutdown"),
    stopServer(server, timeoutMs)
  ]);
  const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
  if (errors.length) throw new AggregateError(errors, "Browser test cleanup failed");
}

export async function runBrowserTest(run, { root, chromium, executablePath, cleanupTimeoutMs = 10000,
  createServer = () => spawn(process.execPath, ["tools/serve.mjs", "--no-browser", "--port", "0"], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true
  })
}) {
  const server = createServer();
  server.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  let browser, failure, result;
  try {
    const url = await waitForBrowserTestServer(server);
    browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox"], timeout: 30000 });
    result = await run({ browser, url });
  } catch (error) { failure = error; }
  try { await closeBrowserTestResources({ browser, server }, cleanupTimeoutMs); }
  catch (error) {
    failure = failure ? new AggregateError([failure, error], "Browser test and cleanup failed") : error;
  }
  if (failure) throw failure;
  return result;
}
