import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { closeBrowserTestResources, runBrowserTest, waitForBrowserTestServer } from "../e2e/browser_test_session.mjs";

const serverSource = `setInterval(() => {}, 1000); console.log(JSON.stringify({ event: 'ready', url: 'http://127.0.0.1:1' }));`;
const startServer = (source = serverSource) => spawn(process.execPath, ["-e", source], {
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true
});

test("browser test startup handles fragmented records and bounds missing readiness", async () => {
  const server = Object.assign(new EventEmitter(), { stdout: new PassThrough() });
  const ready = waitForBrowserTestServer(server, 100);
  server.stdout.write('noise\n{"event":"ready","url":"http://localhost:');
  server.stdout.write('1234"}\n');
  assert.equal(await ready, "http://localhost:1234");
  assert.equal(server.stdout.listenerCount("data"), 0);
  await assert.rejects(waitForBrowserTestServer(server, 10), /startup timed out/);
  assert.equal(server.listenerCount("error"), 0);
  assert.equal(server.listenerCount("exit"), 0);
});

test("normal browser test completion waits for the owned server to exit", async () => {
  let server, closed = false;
  const result = await runBrowserTest(async () => "completed", {
    chromium: { launch: async () => ({ close: async () => { closed = true; } }) },
    createServer: () => (server = startServer()), cleanupTimeoutMs: 1000
  });
  assert.equal(result, "completed");
  assert.equal(closed, true);
  assert.ok(server.exitCode !== null || server.signalCode !== null);
});

test("a failed server spawn is reported without waiting for a nonexistent process", async () => {
  let server;
  await assert.rejects(runBrowserTest(async () => assert.fail("unreachable"), {
    chromium: { launch: async () => assert.fail("unreachable") },
    createServer: () => (server = spawn(process.execPath, [], {
      cwd: fileURLToPath(new URL("nonexistent_browser_test_directory/", import.meta.url)),
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true
    })), cleanupTimeoutMs: 20
  }), { code: "ENOENT" });
  assert.equal(server.pid, undefined);
});

for (const scenario of ["launch-failure", "close-timeout", "body-and-close-failure"]) {
  test(`browser test CLI preserves ${scenario}, exits nonzero, and stops its server`, () => {
    const moduleUrl = new URL("../e2e/browser_test_session.mjs", import.meta.url).href;
    const script = `
      import { spawn } from 'node:child_process';
      import { runBrowserTest } from ${JSON.stringify(moduleUrl)};
      const scenario = ${JSON.stringify(scenario)};
      const result = await runBrowserTest(async () => {
        if (scenario === 'body-and-close-failure') throw new Error('original workflow failure');
        return 'PASSED';
      }, {
        chromium: { launch: async () => {
          if (scenario === 'launch-failure') throw new Error('browser launch failure');
          if (scenario === 'body-and-close-failure') return { close: async () => { throw new Error('browser close failure'); } };
          return { close: () => new Promise(() => {}) };
        } },
        createServer: () => {
          const server = spawn(process.execPath, ['-e', ${JSON.stringify(serverSource)}], { stdio: ['ignore', 'pipe', 'pipe'] });
          console.log('owned_server=' + server.pid);
          return server;
        }, cleanupTimeoutMs: 1000
      });
      console.log(result);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8", timeout: 10000, windowsHide: true
    });
    const pid = Number(result.stdout.match(/owned_server=(\d+)/)?.[1]);
    let serverExited = false;
    try {
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 1, result.stderr);
      assert.doesNotMatch(result.stdout, /PASSED/);
      assert.match(result.stderr, scenario === "launch-failure" ? /browser launch failure/ :
        scenario === "close-timeout" ? /Browser shutdown timed out/ : /browser close failure/);
      if (scenario === "body-and-close-failure") assert.match(result.stderr, /original workflow failure/);
      assert.ok(pid > 0);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      serverExited = true;
    } finally {
      // Only the fixture PID returned by this subprocess can be cleaned up.
      if (!serverExited && pid > 0) { try { process.kill(pid, "SIGKILL"); } catch {} }
    }
  });
}

test("forced server termination is awaited and still fails cleanup", { skip: process.platform === "win32" }, async () => {
  const server = startServer(`process.on('SIGTERM', () => {}); ${serverSource}`);
  try {
    await waitForBrowserTestServer(server);
    await assert.rejects(closeBrowserTestResources({ server }, 300), (error) => {
      assert.match(error.errors[0].message, /server shutdown timed out/);
      return true;
    });
    assert.equal(server.signalCode, "SIGKILL");
  } finally { if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL"); }
});
