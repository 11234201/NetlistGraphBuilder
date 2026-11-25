import http from "node:http";
import https from "node:https";
import {randomBytes} from "node:crypto";
import {readFile, writeFile, readlink, readdir, lstat} from "node:fs/promises";
import {dirname, join} from "node:path";
import {tmpdir} from "node:os";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

const run = promisify(execFile);
const tlsOptions = {minVersion: "TLSv1.2", maxVersion: "TLSv1.2", ciphers: "PSK-AES128-GCM-SHA256"};
const mismatch = cause => Object.assign(new Error("Control endpoint ownership could not be verified", {cause}), {code: "OWNER_MISMATCH"});
const clientKeys = new WeakMap();

async function sessionKey(state) {
  const cached = clientKeys.get(state);
  if (cached) return cached;
  if (typeof state.controlSession !== "string" || !/^ngb-session-[A-Za-z0-9]{6}$/.test(state.controlSession))
    throw mismatch();
  const directory = join(tmpdir(), state.controlSession);
  const keyPath = join(directory, "control.key");
  const [dir, file] = await Promise.all([lstat(directory), lstat(keyPath)]);
  if (!dir.isDirectory() || !file.isFile() || file.size !== 32) throw mismatch();
  // A caller can supply the state path. Check the ACL on the secret itself
  // before using it, including when TEMP points to a shared directory.
  const script = [
    "$ErrorActionPreference='Stop'",
    "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "$acl=[IO.File]::GetAccessControl($env:NGB_CONTROL_KEY_FILE)",
    "if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) {exit 1}",
    "foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {",
    "if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -ne $sid) {exit 1}}"
  ].join("\n");
  const shell = join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
  try { await run(shell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    windowsHide:true, env:{...process.env, NGB_CONTROL_KEY_FILE:keyPath}
  }); } catch (error) { throw mismatch(error); }
  const key = await readFile(keyPath);
  if (key.length !== 32) throw mismatch();
  clientKeys.set(state, key);
  return key;
}

// Windows Node does not expose kernel peer credentials on a connected pipe.
// A private per-session PSK authenticates both ends before sending HTTP.
export async function createControlServer(directory, dispatch) {
  if (process.platform !== "win32") return http.createServer(dispatch);
  const system = join(process.env.SystemRoot, "System32");
  const {stdout} = await run(join(system, "whoami.exe"), ["/user", "/fo", "csv", "/nh"], {windowsHide:true});
  const sid = /"(S-1-[0-9-]+)"\s*$/i.exec(stdout)?.[1];
  if (!sid) throw mismatch();
  await run(join(system, "icacls.exe"), [directory, "/inheritance:r", "/grant:r", "*" + sid + ":(OI)(CI)F"], {windowsHide:true});
  const key = randomBytes(32);
  await writeFile(join(directory, "control.key"), key, {flag:"wx", mode:0o600});
  return https.createServer({...tlsOptions, pskCallback: (_socket, identity) =>
    identity === String(process.pid) ? key : null}, dispatch);
}

async function verifyUnixSocket(state) {
  const dir = await lstat(dirname(state.control));
  const socket = await lstat(state.control);
  if (!dir.isDirectory() || dir.uid !== process.getuid() || (dir.mode & 0o077) ||
      !socket.isSocket() || socket.uid !== process.getuid()) throw mismatch();
  if (process.platform === "darwin") {
    const {stdout} = await run("/usr/sbin/lsof", ["-a", "-nP", "-p", String(state.pid), "-U", "-F0un"]);
    const fields = stdout.split("\0").map(field => field.replace(/^\n/, ""));
    if (!fields.includes("u" + process.getuid()) || !fields.includes("n" + state.control)) throw mismatch();
    return;
  }
  if (process.platform !== "linux") throw mismatch();
  const unix = await readFile("/proc/net/unix","utf8");
  const inode = unix.split("\n").map(line => /^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\d+)\s+(.+)$/.exec(line.trim()))
    .find(row => row?.[2] === state.control)?.[1];
  if (!inode) throw mismatch();
  const folder = "/proc/" + state.pid + "/fd";
  const targets = await Promise.all((await readdir(folder)).map(fd => readlink(join(folder,fd)).catch(() => "")));
  if (!targets.includes("socket:[" + inode + "]")) throw mismatch();
}

export async function workbenchCall(state, body) {
  if (!Number.isSafeInteger(state.pid) || state.pid <= 0 || typeof state.control !== "string") throw mismatch();
  let client = http;
  const options = {socketPath: state.control, path: "/", method: "POST", timeout: 15000, agent:false};
  if (process.platform !== "win32") {
    await verifyUnixSocket(state);
  } else {
    const key = await sessionKey(state);
    client = https;
    // This cipher authenticates with the PSK alone, so no X.509 chain is expected.
    Object.assign(options, tlsOptions, {rejectUnauthorized:false,
      pskCallback: () => ({identity: String(state.pid), psk:key})});
  }
  return new Promise((resolve, reject) => {
    const request = client.request(options, response => {
      const chunks = [];
      response.on("data", part => chunks.push(part));
      response.on("error", reject);
      response.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("Control socket timed out")));
    request.on("error", reject);
    request.end(JSON.stringify(body));
  });
}
