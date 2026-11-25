import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {darwinHasUnixListener, verifyUnixSocket} from "../../tools/workbench_ipc.mjs";

const state = {pid:2718, control:"/tmp/ngb session/control"};
const uid = 501;
// Apple lsof -nP -l -s -Tfq: UNIX has a blank NODE column. QR/QS enable
// printing of AF_UNIX options in the NAME column (lib/ptti.c and print.c).
const row = (name, info, fd = "19u") =>
  "node    2718  501   " + fd + "  unix 0xb8fce69b8da2f647   0     " + name + " (" + info + ")";
const listen = "QR=0 QS=0 SO=ACCEPTCONN,PQLEN=0,QLEN=0,QLIM=128,RCVBUF=8192,SNDBUF=8192 SS=NBIO";
const client = "QR=0 QS=0 SO=PQLEN=0,QLEN=0,QLIM=0,RCVBUF=8192,SNDBUF=8192 SS=ISCONNECTED,NBIO";
const verify = (output, target = state) => darwinHasUnixListener(output, target, uid);

test("Darwin listener evidence belongs to the exact PID, UID, AF_UNIX descriptor and pathname", () => {
  const listener = row(state.control, listen);
  assert.ok(verify([row("->0xabcdef", client, "7u"), listener, row(state.control, client, "22u")].join("\n")));
  assert.equal(verify(listener, {...state, pid:2719}), false);
  assert.equal(darwinHasUnixListener(listener, state, 502), false);
  assert.equal(verify(listener.replace(" unix ", " IPv4 ")), false);
  assert.equal(verify(row(state.control + ".old", listen)), false);
  const unicode = {...state, control:"/tmp/米\\a (local)/control"};
  assert.ok(verify(row("/tmp/\\xe7\\xb1\\xb3\\\\a (local)/control", listen), unicode));
});

test("Darwin rejects connected and bound-only sockets, and evidence split over two descriptors", () => {
  for (const report of [
    row(state.control, client),
    row(state.control, "QR=0 QS=0 SO=PQLEN=0,QLEN=0,QLIM=0 SS=NBIO"),
    row(state.control, "QR=0 QS=0 SO=NO_ACCEPTCONN"),
    row(state.control, "QR=0 QS=0 SS=ACCEPTCONN"),
    row(state.control, client) + "\n" + row(state.control + ".old", listen, "42u"),
    row(state.control + " (SO=ACCEPTCONN)", client),
    "p2718\0u501\0\nf19\0tunix\0n" + state.control + "\0\n"
  ]) assert.equal(verify(report), false);
});

test("Darwin verifies a live Unix listener with the installed Apple lsof", {skip:process.platform !== "darwin"}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "ngb-darwin-"));
  const control = join(directory, "control");
  const server = createServer();
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(control, resolve); });
    await verifyUnixSocket({pid:process.pid, control});
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive:true, force:true});
  }
});
