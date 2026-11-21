import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {join} from "node:path";
import {readFile, readdir} from "node:fs/promises";

export async function verifyWorkbenchClients({adapter, service, page, dir, project, t}) {
  const launcher = adapter === "elf" ? [join(dir, "deploy/ngb")] : adapter === "python" ?
    ["/usr/bin/python3", join(project,"tools/serve.py")] : [process.execPath, join(project, "tools/serve.mjs")];
  const logs = join(dir, adapter + "-client-logs");
  async function invoke(argv, input = "") {
    const cmd = spawn(launcher[0], [...launcher.slice(1), "cmd", "--state-file", service.stateFile, ...argv], {
      cwd:dir, env:{...process.env, NGB_LOG_DIR:logs, ...(adapter === "elf" ? {PATH:"/nonexistent"} : {})}
    });
    const output = [], errors = [];
    const closed = once(cmd, "close");
    cmd.stdout.on("data", chunk => output.push(chunk));
    cmd.stderr.on("data", chunk => errors.push(chunk));
    cmd.stdin.end(input);
    const [code] = await closed;
    const reply = JSON.parse(Buffer.concat(output).toString());
    assert.equal(code, ["failed","cancelled","unknown"].includes(reply.status) ? 1 : 0, Buffer.concat(errors).toString());
    return reply;
  }
  const pageArgs = ["--page", page.page];
  async function verifyInput(argv, source, input) {
    const ready = await invoke([...pageArgs, "design", "open", "--async", ...argv], input);
    assert.ok(["queued", "reading"].includes(ready.status), JSON.stringify(ready));
    const {job} = await service.page(page, "poll", {waitMs:3000});
    assert.equal(job.id, ready.requestId);
    assert.equal((await service.page(page, "inputs", {id:job.id})).files[0].text, source);
    await service.admin("command", {argv:["job", "cancel", job.id]});
  }
  await t.test(adapter + " CLI preserves option-like source text and decodes Tcl arguments strictly", async () => {
    for (const literal of ["--tcl", "--stdin", "--state-file", "--argv-stdin"])
      await verifyInput(["--text", literal], literal);
    await verifyInput(["--stdin", "--name", "--tcl"], "多字节输入", "多字节输入");
    const malformed = await invoke(["--argv-stdin"], "x7061676573 x1z");
    assert.equal(malformed.error.code, "INVALID_ARGUMENT");
    const files = (await readdir(logs)).filter(file => file.endsWith(".error.jsonl"));
    const contents = await Promise.all(files.map(file => readFile(join(logs,file),"utf8")));
    const failures = contents.flatMap(content => content.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)))
      .filter(entry => entry.event === "workbench.client_failed");
    assert.equal(failures.length,1);
    assert.equal(failures[0].details.operation,"cmd");
    assert.equal(failures[0].details.code,"INVALID_ARGUMENT");
    assert.equal(failures[0].details.error.message,"Invalid Tcl argument");
  });
  await t.test(adapter + " explicit empty/duplicate targets fail without delivery; timed-out jobs stay queryable", async () => {
    for (const invalid of [["--page",""], ["--side",""], ["--request-id",""], [...pageArgs,...pageArgs],
                           ["--page",page.page,"page","use",""]]) {
      const argv = invalid.includes("use") ? invalid : ["module","list",...invalid];
      assert.equal((await invoke(argv)).error.code, "INVALID_ARGUMENT");
    }
    assert.equal((await service.page(page, "poll")).job, undefined);
    const timeout = await invoke([...pageArgs,"module","list","--timeout","1"]);
    assert.equal(timeout.error.code, "WAIT_TIMEOUT");
    assert.equal(timeout.page, page.page);
    assert.equal(timeout.jobStatus, "queued");
    assert.equal((await invoke(["job","status",timeout.requestId])).status,"queued");
    await invoke(["job","cancel",timeout.requestId]);
  });
  await t.test(adapter + " retry returns the original receipt after disconnect without delivery to another page", async () => {
    const other = await service.register();
    const argv = ["--page",other.page,"module","list","--async","--request-id","closed-page-retry"];
    const queued = await invoke(argv);
    assert.equal(queued.status, "queued");
    await service.page(other,"leave");
    const retry = await invoke(argv);
    assert.equal(retry.requestId, queued.requestId);
    assert.equal(retry.page, other.page);
    assert.equal(retry.status, "cancelled");
    assert.equal((await invoke(argv.map(arg => arg === other.page ? page.page : arg))).error.code, "REQUEST_CONFLICT");
    assert.equal((await service.page(page, "poll")).job, undefined);
  });
}
