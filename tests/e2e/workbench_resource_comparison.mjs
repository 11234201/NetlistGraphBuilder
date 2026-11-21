// Linux, two source checkouts, one Node and Chromium installation. Pass
// BASELINE_DIR CURRENT_DIR [rounds] and redirect stdout to the report file.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {readFile,mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createInterface} from "node:readline";
import {performance} from "node:perf_hooks";
import {createHash} from "node:crypto";

const {chromium} = await import(process.env.NGB_PLAYWRIGHT_MODULE || "playwright");
const [baseline,current] = process.argv.slice(2).map(value => resolve(value));
const rounds = Number(process.argv[4] || 3);
assert.ok(baseline && current && Number.isSafeInteger(rounds) && rounds > 0);
const sources = ["examples/aig_mapped_names.blif","examples/aig_structure_demo.blif","examples/module_hierarchy_demo.v"];
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const milliseconds = start => Math.round((performance.now() - start) * 10) / 10;

function instrumentPage() {
  const metrics = window.workbenchPerf = {calls:0,workers:0,peakWorkers:0,sourceWrites:0,sourceBytes:0,archiveBytes:0};
  window.Worker = class extends Worker {
    constructor(...args) {
      super(...args);
      this.graphviz = new URL(args[0],location.href).pathname.endsWith("/graphviz_worker.js");
      if (this.graphviz) metrics.peakWorkers = Math.max(++metrics.workers,metrics.peakWorkers);
    }
    postMessage(...args) {
      if (this.graphviz) metrics.calls++;
      return super.postMessage(...args);
    }
    terminate() {
      if (this.graphviz) { metrics.workers--; this.graphviz = false; }
      super.terminate();
    }
  };
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key,value) {
    const result = original.call(this,key,value);
    if (key.startsWith("ngb.aig-source.") || key === "ngb.domain-workspace.v1" || key === "ngb.aig-collection.v1") {
      const bytes = new TextEncoder().encode(value).length;
      metrics.archiveBytes += bytes;
      if (key.startsWith("ngb.aig-source.")) { metrics.sourceWrites++; metrics.sourceBytes += bytes; }
    }
    return result;
  };
}

async function rssKiB(pid) {
  try { return Number(/^VmRSS:\s+(\d+)/m.exec(await readFile("/proc/"+pid+"/status","utf8"))?.[1] || 0); }
  catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH") return 0; throw error; }
}

async function run(root) {
  const dir = await mkdtemp(join(tmpdir(),"ngb-perf-")), state = join(dir,"state.json");
  const launcher = join(root,"tools/serve.mjs");
  const options = {cwd:root,env:{...process.env,NGB_LOG_DIR:join(dir,"logs")}};
  const host = spawn(process.execPath,[launcher,"start","--port","0","--no-open","--state-file",state,"--browse-root",root],options);
  const closed = once(host,"close"), lines = createInterface({input:host.stdout});
  host.stderr.resume();
  let browser, stop = false, sampling, sampleFailure;
  const memory = {hostRssKiB:0,browserRssKiB:0,twoPageHeapBytes:0,samples:0,sampleDelayMs:50};
  try {
    const ready = JSON.parse((await once(lines,"line"))[0]);
    browser = await chromium.launch({executablePath:process.env.NGB_CHROME_BINARY,headless:true,args:["--no-sandbox"]});
    const context = await browser.newContext({viewport:{width:1600,height:1000}});
    await context.addInitScript(instrumentPage);
    const pages = await Promise.all([context.newPage(),context.newPage()]);
    const ids = await Promise.all(pages.map(async page => {
      await page.goto(ready.pairUrl);
      await page.waitForFunction(() => /^p\d+/.test(document.getElementById("remotePageLabel")?.textContent));
      return page.evaluate(() => JSON.parse(sessionStorage.getItem("ngb.remote.page")).page);
    }));
    assert.notEqual(...ids);
    const cdp = await browser.newBrowserCDPSession();
    const tabs = await Promise.all(pages.map(page => context.newCDPSession(page)));
    await Promise.all(tabs.map(tab => tab.send("Performance.enable")));
    async function sample() {
      const [{processInfo},heap,hostRss] = await Promise.all([cdp.send("SystemInfo.getProcessInfo"),
        Promise.all(tabs.map(tab => tab.send("Performance.getMetrics"))),rssKiB(host.pid)]);
      const rss = await Promise.all(processInfo.map(proc => rssKiB(proc.id)));
      memory.browserRssKiB = Math.max(memory.browserRssKiB,rss.reduce((a,b) => a+b,0));
      memory.hostRssKiB = Math.max(memory.hostRssKiB,hostRss);
      memory.twoPageHeapBytes = Math.max(memory.twoPageHeapBytes,heap.reduce((total,result) =>
        total + result.metrics.find(m => m.name === "JSHeapUsedSize").value,0));
      memory.samples++;
    }
    sampling = (async () => { while (!stop) { await sample(); await sleep(memory.sampleDelayMs); } })().catch(err => { sampleFailure = err; });
    async function command(id,...args) {
      const cli = spawn(process.execPath,[launcher,"cmd","--state-file",state,"--page",id,"--timeout","15000",...args],options);
      cli.stdin.end();
      const out = [], err = [];
      cli.stdout.on("data",chunk => out.push(chunk)); cli.stderr.on("data",chunk => err.push(chunk));
      await once(cli,"close");
      const reply = JSON.parse(Buffer.concat(out).toString() || JSON.stringify({error:Buffer.concat(err).toString()}));
      assert.ok(!reply.error,JSON.stringify({args,error:reply.error}));
      return reply;
    }
    await Promise.all([command(ids[0],"aig","open",join(root,sources[0])),command(ids[1],"design","open",join(root,sources[2]))]);
    const read = () => pages[0].evaluate(() => ({...window.workbenchPerf}));
    const initial = await read();
    assert.ok(initial.calls > 0);
    async function measure(...args) {
      const start = performance.now();
      const reply = await command(ids[0],...args);
      assert.equal(reply.status,"committed");
      return milliseconds(start);
    }
    const addMs = await measure("aig","add",join(root,sources[1]));
    const afterAdd = await read();
    assert.equal(afterAdd.calls,initial.calls);
    const graphs = (await command(ids[0],"module","list")).result;
    assert.equal(graphs.length,2);
    const first = graphs.find(g => g.active), second = graphs.find(g => !g.active);
    const firstSwitchMs = await measure("module","open",second.id);
    const afterFirst = await read();
    const returnMs = await measure("module","open",first.id);
    const afterReturn = await read();
    const repeatMs = [];
    for (let i=0; i<12; i++) repeatMs.push(await measure("module","open",i%2 ? first.id : second.id));
    const afterRepeat = await read();
    assert.equal(afterRepeat.sourceWrites,afterAdd.sourceWrites);
    const info = (await command(ids[0],"design","info")).result;
    const held = [];
    let release;
    await pages[0].route("**/__ngb/workbench",async route => {
      const msg = route.request().postDataJSON();
      if (msg.op === "grant" && msg.id.startsWith("perf-")) await new Promise(resolve => { release = resolve; });
      await route.continue().catch(() => {});
    });
    let peerMs, drainMs;
    try {
      for (let i=0;i<8;i++) {
        const submitted = await command(ids[0],"--async","--request-id","perf-"+i,"module","list");
        assert.ok(["queued","reading","delivered"].includes(submitted.status),submitted.status);
        held.push(submitted.requestId);
      }
      const start = performance.now();
      const peer = await command(ids[1],"module","list");
      peerMs = milliseconds(start);
      assert.equal(peer.status,"committed");
      assert.ok(peer.result.some(module => module.name === "hierarchy_demo_top"));
      const check = await Promise.all(held.map(id => command(ids[0],"job","status",id)));
      assert.ok(check.every(result => ["queued","reading","delivered"].includes(result.status)));
    } finally {
      const start = performance.now();
      await pages[0].unroute("**/__ngb/workbench");
      release?.();
      const settled = await Promise.all(held.map(id => command(ids[0],"job","wait",id)));
      assert.ok(settled.every(job => job.status === "committed"));
      drainMs = milliseconds(start);
    }
    assert.equal(afterRepeat.peakWorkers,1);
    assert.equal((await pages[1].evaluate(() => window.workbenchPerf)).calls,0);
    return {browser:browser.version(),addMs,firstSwitchMs,returnMs,repeatMs,queue:{held:held.length,peerMs,drainMs},memory,
      graphviz:{open:initial.calls,add:afterAdd.calls-initial.calls,first:afterFirst.calls-afterAdd.calls,
        back:afterReturn.calls-afterFirst.calls,repeated:afterRepeat.calls-afterReturn.calls,live:afterRepeat.workers,peak:afterRepeat.peakWorkers},
      storage:{addSourceWrites:afterAdd.sourceWrites-initial.sourceWrites,addSourceBytes:afterAdd.sourceBytes-initial.sourceBytes,
        switchSourceWrites:afterRepeat.sourceWrites-afterAdd.sourceWrites,switchSourceBytes:afterRepeat.sourceBytes-afterAdd.sourceBytes,
        archiveBytes:afterRepeat.archiveBytes},cache:info.resources || null};
  } finally {
    stop = true;
    await sampling;
    await browser?.close();
    lines.close(); host.kill(); await closed;
    await rm(dir,{recursive:true,force:true});
    if (sampleFailure) throw sampleFailure;
  }
}

const fingerprints = {};
for (const file of sources) {
  const input = await readFile(join(baseline,file));
  assert.deepEqual(await readFile(join(current,file)),input);
  fingerprints[file] = createHash("sha256").update(input).digest("hex");
}
const report = {node:process.version,kernel:(await readFile("/proc/sys/kernel/osrelease","utf8")).trim(),fingerprints,baseline:[],current:[]};
for (let i=0;i<rounds;i++) {
  const order = i%2 ? [["current",current],["baseline",baseline]] : [["baseline",baseline],["current",current]];
  for (const [label,root] of order) {
    report[label].push(await run(root));
    console.error(label+" round "+(i+1)+" completed");
  }
}
console.log(JSON.stringify(report));
