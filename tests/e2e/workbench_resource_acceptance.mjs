import assert from "node:assert/strict";
import {join} from "node:path";

export function countWorkbenchWorkers() {
  const counts = {};
  window.workbenchWorkerCounts = counts;
  window.Worker = class extends Worker {
    constructor(...args) {
      super(...args);
      const path = new URL(args[0], location.href).pathname.split("/").pop();
      const count = counts[path] ||= {live:0, peak:0, created:0};
      count.live++;
      count.created++;
      count.peak = Math.max(count.live, count.peak);
      this.usage = count;
    }
    terminate() {
      if (this.usage) { this.usage.live--; this.usage = null; }
      return super.terminate();
    }
  };
}

export async function verifyResourceLimits({ok,run,page,project}) {
  await ok("aig","open",join(project,"examples/aig_mapped_names.blif"));
  await ok("aig","add",join(project,"tests/fixtures/aig/shared_cone.dot"));
  const graphs = (await ok("module","list")).result;
  assert.equal(graphs.length,2);
  let entries = 0, nodes = 0, limits;
  for (let i=0; i<12; i++) {
    await ok("module","open",graphs[i%graphs.length].id);
    const {resources} = (await ok("design","info")).result;
    limits = resources;
    entries = Math.max(entries,resources.cacheEntries);
    nodes = Math.max(nodes,resources.cacheNodes);
  }
  assert.ok(entries > 0 && entries <= limits.maxEntries);
  assert.ok(nodes > 0 && nodes <= limits.maxNodes);
  const workers = await page.evaluate(()=>window.workbenchWorkerCounts);
  assert.equal(workers["graphviz_worker.js"]?.peak,1);
  const pending = [];
  const routeUrl = "**/__ngb/workbench";
  let release;
  const gate = new Promise(resolve=>{release=resolve;});
  const hold = async route=>{
    const message = route.request().postDataJSON();
    if (message.op === "grant" && message.id.startsWith("capacity-")) await gate;
    await route.continue().catch(()=>{});
  };
  await page.route(routeUrl,hold);
  try {
    for (let i=0; i<64; i+=4) {
      const batch = await Promise.all(Array.from({length:4},(_,n)=>
        ok("--async","--request-id","capacity-"+(i+n),"module","list")));
      for (const receipt of batch) {
        assert.ok(["queued","reading","delivered"].includes(receipt.status),receipt.status);
        pending.push(receipt.requestId);
      }
    }
    assert.equal((await run("--async","--request-id","capacity-overflow","module","list")).error?.code,"QUEUE_FULL");
  } finally {
    for (let i=0; i<pending.length; i+=4) {
      const cancelled = await Promise.all(pending.slice(i,i+4).map(id=>run("job","cancel",id)));
      for (const receipt of cancelled) assert.equal(receipt.status,"cancelled");
    }
    release();
    await page.unroute(routeUrl,hold);
  }
  assert.equal((await ok("module","list")).result.length,2);
  return {switches:12,workers,cache:{peakEntries:entries,peakNodes:nodes,maxEntries:limits.maxEntries,maxNodes:limits.maxNodes},peakPending:pending.length,overflow:"QUEUE_FULL"};
}
