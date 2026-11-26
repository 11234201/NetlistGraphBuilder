import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const windows = process.platform === "win32";
const shell = windows ? process.env.ComSpec : "/bin/bash";
const entry = join(root, windows ? "ngb.cmd" : "ngb");
await mkdir(join(root, "dc_runs"), {recursive:true});
const scratch = await mkdtemp(join(root, "dc_runs", "universal launcher & "));
const cwd = join(scratch, "caller 中文 with spaces");
await mkdir(cwd);
const logs = join(scratch, "logs");
let checks = 0;
const quote = value => '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
const posixQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const baseEnv = {...process.env, NGB_LOG_DIR:logs};
delete baseEnv.NGB_RUNTIME;

function invocation(args, path = entry) {
  return windows ? {command:shell, args:["/d", "/s", "/c", '"' + [path, ...args].map(quote).join(" ") + '"'], windowsVerbatimArguments:true}
    : {command:shell, args:[path, ...args]};
}
function start(args, {env = {}, path = entry, directory = cwd} = {}) {
  const spec = invocation(args, path);
  return spawn(spec.command, spec.args, {cwd:directory, env:{...baseEnv, ...env}, windowsHide:true,
    windowsVerbatimArguments:spec.windowsVerbatimArguments, stdio:["pipe", "pipe", "pipe"]});
}
async function collect(child, input = "") {
  let stdout = "", stderr = "";
  child.stdout.on("data", data => stdout += data);
  child.stderr.on("data", data => stderr += data);
  const timer = setTimeout(() => child.kill(), 20000);
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  try {
    const code = await new Promise((done, fail) => { child.once("error", fail); child.once("close", done); });
    return {code, stdout, stderr};
  } finally { clearTimeout(timer); }
}
const run = (args, options, input) => collect(start(args, options), input);
const records = result => result.stderr.split(/\r?\n/).filter(line => line.startsWith("{")).map(line => JSON.parse(line));
function passed(name) { checks++; console.log("PASS " + name); }

async function failureHost(runtime) {
  const fixture = join(scratch,"parent_failure",runtime);
  const toolDirectory = join(fixture,"tools");
  await mkdir(toolDirectory, {recursive:true});
  // A separate host tree injects a failed helper response without changing the
  // user's files or core Windows variables required by the runtime itself.
  for (const name of await readdir(join(root,"tools"))) {
    if (/\.(?:mjs|py)$/.test(name)) await copyFile(join(root,"tools",name),join(toolDirectory,name));
  }
  await symlink(join(root,"src"),join(fixture,"src"),"junction");
  await writeFile(join(toolDirectory,"launcher_parent.ps1"),
    "[Console]::WriteLine('{\"error\":{\"name\":\"CimException\",\"message\":\"injected identity query failed\",\"stack\":\"injected.ps1:1\",\"code\":\"PARENT_WATCH_FAILED\"}}')\n");
  return join(toolDirectory,runtime === "node" ? "serve.mjs" : "serve.py");
}

async function makeFakeExecutables() {
  const bin = join(scratch, "runtime bin");
  await mkdir(bin);
  if (windows) {
    const source = join(scratch, "RuntimeProbe.cs");
    const exe = join(scratch, "RuntimeProbe.exe");
    await writeFile(source, `using System; using System.Diagnostics; using System.IO; using System.Web.Script.Serialization;
public static class RuntimeProbe {
 public static int Main(string[] args) {
  Console.OutputEncoding = new System.Text.UTF8Encoding(false); Console.InputEncoding = new System.Text.UTF8Encoding(false);
  string candidate = Path.GetFileNameWithoutExtension(Process.GetCurrentProcess().MainModule.FileName);
  bool probe = args.Length > 0 && (args[0] == "-e" || args[0] == "-c" || (args[0] == "-3" && args.Length > 1 && args[1] == "-c"));
  File.AppendAllText(Environment.GetEnvironmentVariable("NGB_TEST_TRACE"), candidate + (probe ? ":probe" : ":run") + "\\n");
  if (probe) return Int32.Parse(Environment.GetEnvironmentVariable("NGB_TEST_PROBE_" + candidate.ToUpperInvariant()) ?? "1");
  Console.WriteLine(new JavaScriptSerializer().Serialize(new {candidate, args, cwd=Environment.CurrentDirectory, input=Console.In.ReadToEnd()}));
  return Int32.Parse(Environment.GetEnvironmentVariable("NGB_TEST_EXIT") ?? "0");
 }
}`);
    const compiler = join(process.env.SystemRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    const child = spawn(compiler, ["/nologo", "/reference:System.Web.Extensions.dll", "/out:" + exe, source], {windowsHide:true, stdio:["pipe","pipe","pipe"]});
    const result = await collect(child);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    for (const candidate of ["node", "py", "python3", "python"]) await copyFile(exe, join(bin, candidate + ".exe"));
  } else {
    const echo = join(scratch, "echo_arguments.mjs");
    await writeFile(echo, `import fs from "node:fs";
console.log(JSON.stringify({candidate:process.argv[2],args:process.argv.slice(3),cwd:process.cwd(),input:fs.readFileSync(0,"utf8")}));
process.exit(Number(process.env.NGB_TEST_EXIT || 0));\n`);
    for (const candidate of ["node", "python3", "python"]) {
      const path = join(bin, candidate);
      await writeFile(path, `#!/bin/bash\nif [[ "$1" == -e || "$1" == -c ]]; then\n  printf '%s\\n' '${candidate}:probe' >> "$NGB_TEST_TRACE"\n  exit "\${NGB_TEST_PROBE_${candidate.toUpperCase()}:-1}"\nfi\nprintf '%s\\n' '${candidate}:run' >> "$NGB_TEST_TRACE"\nexec ${posixQuote(process.execPath)} ${posixQuote(echo)} '${candidate}' "$@"\n`);
      await chmod(path, 0o755);
    }
    for (const utility of ["bash", "dirname", "readlink", "mkdir", "date"]) await symlink("/bin/" + utility, join(bin, utility));
  }
  return bin;
}

async function verifySelection() {
  const bin = await makeFakeExecutables();
  const trace = join(scratch, "trace.txt");
  const env = {PATH:bin, NGB_TEST_TRACE:trace, NGB_TEST_PROBE_NODE:"0", NGB_TEST_PROBE_PY:"0", NGB_TEST_PROBE_PYTHON3:"0", NGB_TEST_PROBE_PYTHON:"0"};
  const expected = ["cmd", "--state-file", "relative state.json", "", "space 汉字", "&", "!", "%", "^", "slash\\", "--browse-root", "one", "--browse-root", "two"];
  let result = await run(expected, {env}, "stdin 汉字\n");
  assert.equal(result.code, 0, result.stderr);
  let actual = JSON.parse(result.stdout);
  assert.equal(actual.candidate, "node");
  assert.deepEqual(actual.args, [join(root, "tools", "serve.mjs"), ...expected]);
  assert.equal(actual.cwd, cwd);
  assert.equal(actual.input, "stdin 汉字\n");
  passed("Node preference, exact argv, caller cwd and stdin");

  result = await run(expected, {env:{...env, NGB_TEST_EXIT:"37"}});
  assert.equal(result.code, 37);
  assert.equal(JSON.parse(result.stdout).candidate, "node");
  assert.equal(records(result).filter(row => row.event === "bootstrap.failed").length, 0);
  assert.equal((await readFile(trace,"utf8")).includes("python3:run"), false);
  passed("host failure preserves exit code without fallback or duplicate failure log");

  result = await run(expected, {env:{...env, NGB_TEST_PROBE_NODE:"1"}});
  actual = JSON.parse(result.stdout);
  assert.equal(actual.candidate, windows ? "py" : "python3");
  assert.deepEqual(actual.args, [...(windows ? ["-3"] : []), "-u", join(root, "tools", "serve.py"), ...expected]);
  passed("unusable Node falls back to Python, including Windows py -3");

  result = await run([], {env:{...env, NGB_RUNTIME:"python", NGB_TEST_PROBE_PY:"1", NGB_TEST_PROBE_PYTHON3:"1"}});
  assert.equal(JSON.parse(result.stdout).candidate, "python");
  passed("Python candidate fallback and explicit runtime selection");
  result = await run([], {env:{...env, [windows ? "ngb_runtime" : "NGB_RUNTIME"]:"PyThOn"}});
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).candidate, windows ? "py" : "python3");
  passed("case-insensitive runtime value and Windows environment key");

  for (const forced of ["auto", "node", "python"]) {
    result = await run([], {env:{...env, NGB_RUNTIME:forced, NGB_TEST_PROBE_NODE:"1", NGB_TEST_PROBE_PY:"1", NGB_TEST_PROBE_PYTHON3:"1", NGB_TEST_PROBE_PYTHON:"1"}});
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    const failures = records(result).filter(row => row.event === "bootstrap.failed");
    assert.equal(failures.length, 1);
    assert.equal(failures[0].details.code, "RUNTIME_UNAVAILABLE");
    assert.equal(failures[0].details.operation, "bootstrap");
    assert.equal(failures[0].details.error.name, "BootstrapError");
  }
  result = await run([], {env:{...env, NGB_RUNTIME:"invalid"}});
  assert.equal(result.code, 2);
  assert.equal(records(result).find(row => row.event === "bootstrap.failed").details.code, "INVALID_RUNTIME");
  passed("missing and invalid runtime produce one structured failure and no stdout");

  const blocked = join(scratch, windows ? "log-is-a-file" : 'log " \\ \n file');
  await writeFile(blocked, "blocked");
  result = await run([], {env:{...env, NGB_RUNTIME:"invalid", NGB_LOG_DIR:blocked}});
  assert.equal(result.code, 2);
  assert.equal(records(result).filter(row => row.event === "log.write_failed").length, 1);
  if (windows) {
    const failure = records(result).find(row => row.event === "log.write_failed");
    assert.equal(failure.details.code, "LOG_WRITE_FAILED");
    assert.ok(failure.details.error.stack);
  } else {
    const failure = records(result).find(row => row.event === "log.write_failed");
    assert.equal(failure.details.code, "LOG_WRITE_FAILED");
    assert.equal(failure.details.error.name, "ShellError");
    assert.equal(failure.details.directory, blocked);
    const original = await collect(spawn("/bin/mkdir",["-p","--",blocked], {argv0:"mkdir",stdio:["pipe","pipe","pipe"]}));
    assert.equal(failure.details.error.message, original.stderr.trimEnd());
    assert.ok(failure.details.error.exitCode > 0);
  }
  assert.equal(records(result).filter(row => row.event === "bootstrap.failed").length, 1);
  const exported = (await Promise.all((await readdir(logs)).filter(name => name.endsWith(".error.jsonl")).map(name => readFile(join(logs,name), "utf8")))).join("");
  assert.ok(exported.split(/\r?\n/).filter(Boolean).map(JSON.parse).some(row => row.details?.code === "RUNTIME_UNAVAILABLE"));
  passed("JSONL failures retain context and logging failure preserves original exit");

  if (!windows) {
    const linked = join(scratch, "linked ngb");
    await symlink(entry, linked);
    result = await run(expected, {env, path:linked});
    assert.deepEqual(JSON.parse(result.stdout).args, [join(root,"tools","serve.mjs"), ...expected]);
    result = await run(expected, {env, path:join(root,"tools","start-preview.sh")});
    assert.equal(JSON.parse(result.stdout).cwd, cwd);
    passed("symlinked launcher and legacy entry preserve source root and caller cwd");
  }
}

async function waitForReady(child) {
  let stdout = "", stderr = "";
  child.stderr.on("data", data => stderr += data);
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("Ready timeout: " + stderr)), 25000);
    child.once("error", error => { clearTimeout(timer); fail(error); });
    child.once("exit", code => { clearTimeout(timer); fail(new Error("Exited before ready " + code + ": " + stderr)); });
    child.stdout.on("data", data => {
      stdout += data;
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.startsWith("{")) continue;
        try { const ready = JSON.parse(line); if (ready.event === "ready") { clearTimeout(timer); done(ready); } } catch {}
      }
    });
  });
}

async function verifyRealRuntime(runtime) {
  const state = join(cwd, runtime + " state.json");
  const env = {NGB_RUNTIME:runtime};
  const child = start(["start", "--state-file", state, "--netlist", "./relative.v", "--port", "0", "--no-open", "--no-interactive"], {env});
  let active = child;
  let ready;
  try {
    ready = await waitForReady(child);
    assert.equal(ready.startup.netlist, "relative.v");
    assert.equal(ready.host, "127.0.0.1");
    const saved = JSON.parse(await readFile(state,"utf8"));
    if (!windows) assert.equal(saved.pid, child.pid, "exec preserves launcher PID");
    let result = await run(["status", "--state-file", state], {env});
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /status=running/);
    result = await run(["cmd", "--state-file", state, "pages", "--json"], {env});
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "committed");
    result = await run(["cmd", "--state-file", state, "--tcl", "--argv-stdin"], {env}, "x7061676573\n");
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /status/);
    result = await run(["--not-a-launcher-option"], {env});
    assert.equal(result.code, 2);
    assert.equal(records(result).filter(row => row.event === "bootstrap.failed").length, 0);
    if (windows) {
      const before = await readFile(state,"utf8");
      const command = runtime === "node" ? process.execPath : (process.env.NGB_PYTHON || "python");
      const script = await failureHost(runtime);
      const failure = spawn(command, [script,"start","--replace","--state-file",state,"--parent-death","--no-open"], {
        cwd, env:{...baseEnv, NGB_LAUNCHER_CMD:"1"}, windowsHide:true, stdio:["pipe","pipe","pipe"]});
      result = await collect(failure);
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.equal(result.stdout, "");
      const failures = records(result).filter(row => row.event === "parent.watch_failed");
      assert.equal(failures.length, 1);
      assert.equal(failures[0].details.code, "PARENT_WATCH_FAILED");
      assert.ok(failures[0].details.error.stack);
      const original = runtime === "node" ? failures[0].details.error.cause : failures[0].details.diagnostic;
      assert.equal(original.name, "CimException");
      assert.equal(original.stack, "injected.ps1:1");
      assert.equal(await readFile(state,"utf8"), before, "parent-watch failure precedes replace");
      assert.equal((await fetch(ready.url)).status, 200, "old server remains usable");
      passed(runtime + " parent-watch failure preserves original error and existing session");
    }
    passed(runtime + " real relative-path start/status/cmd/Tcl/invalid-argument protocol");
    const previous = JSON.parse(await readFile(state,"utf8"));
    active = start(["start", "--replace", "--state-file", state, "--port", "0", "--no-open", "--no-interactive"], {env});
    ready = await waitForReady(active);
    assert.notEqual(JSON.parse(await readFile(state,"utf8")).pid, previous.pid);
    passed(runtime + " --replace through the same entry");
    if (!windows) {
      const exited = new Promise(done => active.once("exit", done));
      active.kill("SIGTERM");
      await exited;
      await assert.rejects(readFile(state), error => error.code === "ENOENT");
      passed(runtime + " SIGTERM reaches host and cleans its state");
    }
  } finally {
    if (ready) {
      const result = await run(["stop", "--state-file", state], {env});
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /status=stopped/);
    } else child.kill();
    child.stdin.destroy();
    active.stdin.destroy();
  }
}

async function verifyParentDeath(runtime, origin) {
  const state = join(cwd, runtime + " " + origin + " parent.json");
  const args = ["start", "--state-file", state, "--port", "0", "--no-open", "--no-interactive", "--parent-death"];
  const env = {...baseEnv, NGB_RUNTIME:runtime, NGB_TEST_ENTRY:entry, NGB_TEST_STATE:state};
  const options = {cwd, env, windowsHide:true, stdio:["pipe","pipe","pipe"]};
  let parent;
  if (origin === "powershell") {
    const script = join(scratch,"parent.ps1");
    await writeFile(script, '& $env:NGB_TEST_ENTRY start --state-file $env:NGB_TEST_STATE --port 0 --no-open --no-interactive --parent-death\n');
    parent = spawn(join(process.env.SystemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe"),
      ["-NoProfile","-ExecutionPolicy","Bypass","-File",script], options);
  } else if (origin === "tcl") {
    const script = join(scratch,"parent_tcl.py");
    await writeFile(script, 'import tkinter, os\ntkinter.Tcl().call("exec", os.environ["NGB_TEST_ENTRY"], "start", "--state-file", os.environ["NGB_TEST_STATE"], "--port", "0", "--no-open", "--no-interactive", "--parent-death", ">@stdout", "2>@stderr")\n');
    parent = spawn(process.env.NGB_PYTHON || "python", [script], options);
  } else {
    const spec = invocation(args);
    const script = join(scratch,"parent_node.mjs");
    await writeFile(script, `import {spawn} from "node:child_process";\nconst child=spawn(${JSON.stringify(spec.command)},${JSON.stringify(spec.args)}, {windowsHide:true,windowsVerbatimArguments:${!!spec.windowsVerbatimArguments},stdio:["ignore","pipe","pipe"]});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);\n`);
    parent = spawn(process.execPath, [script], options);
  }
  let ready;
  try {
    ready = await waitForReady(parent);
    assert.equal((await fetch(ready.url)).status, 200);
    parent.kill();
    const deadline = Date.now() + 8000;
    let stopped = false;
    while (Date.now() < deadline) {
      try { await fetch(ready.url, {signal:AbortSignal.timeout(500)}); }
      catch { stopped = true; break; }
      await new Promise(done => setTimeout(done,100));
    }
    assert.ok(stopped, runtime + " server must exit after " + origin + " caller exits");
    await assert.rejects(readFile(state), error => error.code === "ENOENT");
    passed(runtime + " --parent-death from " + origin);
  } finally {
    parent.kill();
    if (ready) await run(["stop","--state-file",state], {env:{NGB_RUNTIME:runtime}});
    parent.stdin.destroy();
  }
}

try {
  if (!process.argv.includes("--parent-only")) await verifySelection();
  if (!process.argv.includes("--fake-only")) {
    await writeFile(join(cwd,"relative.v"), "module top(input a, output y); assign y = a; endmodule\n");
    for (const runtime of ["node", "python"]) {
      if (!process.argv.includes("--parent-only")) await verifyRealRuntime(runtime);
      for (const origin of (windows ? ["cmd", "powershell", "tcl"] : ["shell"])) await verifyParentDeath(runtime, origin);
    }
  }
  console.log(JSON.stringify({status:"passed", platform:process.platform, checks}));
} finally {
  await rm(scratch, {recursive:true, force:true});
}
