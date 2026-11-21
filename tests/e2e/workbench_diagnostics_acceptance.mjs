import assert from "node:assert/strict";
import {readdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";

function jsonLines(text) {
  return text.replace(/^\uFEFF/,"").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

async function terminalErrors(directory) {
  const files = (await readdir(directory)).filter(file => /\.error\.jsonl(?:\.1)?$/.test(file));
  const entries = await Promise.all(files.map(async file => jsonLines(await readFile(join(directory,file),"utf8"))));
  return entries.flat();
}

export async function verifyCommandDiagnostics({run,page,dir,project,target}) {
  const sourceMarker = "R21_TEST_SOURCE_CONTENT_ONLY";
  const secretMarker = "R21_TEST_CREDENTIAL_ONLY";
  async function ok(...args) {
    const receipt = await run(...args);
    assert.equal(receipt.status,"committed",JSON.stringify(receipt));
    return receipt.result;
  }
  async function fail(...args) {
    const receipt = await run(...args);
    assert.equal(receipt.status,"failed",args.slice(0,2).join(" "));
    assert.ok(receipt.requestId && receipt.error?.code && receipt.error.message);
    assert.equal(receipt.page,target);
    return receipt;
  }
  function correlate(records,receipt,context,operation) {
    const rows = records.filter(entry => entry.details?.requestId === receipt.requestId);
    assert.equal(rows.length,1,"Expected a single owner log for " + operation + ", found " + rows.length);
    const {details} = rows[0];
    assert.equal(rows[0].level,"error");
    assert.equal(details.page,target);
    assert.ok(details.operation && details.code);
    assert.ok([details.operation,details.command].includes(operation));
    for (const [key,value] of Object.entries(context)) {
      assert.ok(value != null,"Missing expected target context " + key);
      assert.equal(details[key],value,operation + " recorded another " + key);
    }
    assert.ok(details.error?.message,"Missing original exception for " + operation);
    return rows[0];
  }

  const source = "// " + sourceMarker + "\nmodule diagnostic_top(input a,output z); BUF g(.A(a),.Y(z)); endmodule\n" +
    "module diagnostic_peer(input a,output z); INV h(.A(a),.Y(z)); endmodule";
  await ok("design","open","--text",source,"--name","diagnostic-pair.v");
  await ok("compare","enter");
  await ok("log","clear");
  await ok("log","filter","--level","all","--phase","all");
  const pair = await ok("ui","status");
  const missing = await fail("timing","open",join(dir,"R21-missing.rpt"),"--side","B");

  await ok("aig","open",join(project,"examples","aig_structure_demo.blif"));
  const graph = await ok("ui","status");
  const graphScope = {graphId:graph.graphId,documentId:graph.documentId,documentVersion:graph.documentVersion};
  const blockedOutput = join(dir,"R21-existing.svg");
  await writeFile(blockedOutput,"retain existing export",{flag:"wx"});
  const output = await fail("svg","export","--out",blockedOutput);
  assert.equal(await readFile(blockedOutput,"utf8"),"retain existing export");

  const bad = "# " + sourceMarker + "\n# password=" + secretMarker + "\n.model broken\n.inputs a\n.outputs z\n10 1\n.end";
  const parsed = await fail("aig","open","--text",bad,"--name","R21-broken.blif");
  assert.equal(parsed.error.details?.error?.diagnostic?.line,6);
  assert.equal(parsed.error.details.error.diagnostic.column,1);
  assert.equal(parsed.error.details.error.diagnostic.file,"R21-broken.blif");
  assert.equal((await ok("ui","status")).graphId,graph.graphId);

  await ok("analysis","run");
  // Send one malformed request into the actual structure Worker. Its own
  // exception must survive serialization, restoration, logging, and the ACK.
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    globalThis.restoreR21Worker = () => { Worker.prototype.postMessage = send; };
    Worker.prototype.postMessage = function(message,...rest) {
      if (message?.type === "analyze") {
        globalThis.restoreR21Worker();
        return send.call(this,{...message,type:"detail",result:null},...rest);
      }
      return send.call(this,message,...rest);
    };
  });
  let worker;
  try { worker = await fail("analysis","run"); }
  finally { await page.evaluate(() => { globalThis.restoreR21Worker(); delete globalThis.restoreR21Worker; }); }
  for (const failure of [parsed,worker]) {
    const details = failure.error.details;
    assert.equal(details.requestId,failure.requestId);
    assert.equal(details.page,target);
    assert.equal(details.graphId,graph.graphId);
    assert.ok(details.error.message && details.error.stack);
  }
  assert.match(worker.error.details.error.stack,/structure_worker\.js/);
  assert.equal((await ok("analysis","status")).status,"error");
  assert.equal((await ok("analysis","run")).status,"complete");

  const end = join(dir,"R21-process.jsonl");
  await ok("log","export","--out",end);
  const entries = jsonLines(await readFile(end,"utf8"));
  const parseEntry = correlate(entries,parsed,graphScope,"aig open");
  const workerEntry = correlate(entries,worker,graphScope,"analysis run");
  for (const [entry,receipt] of [[parseEntry,parsed],[workerEntry,worker]]) {
    const error = entry.details.error;
    assert.equal(error.message,receipt.error.details.error.message);
    assert.equal(error.stack,receipt.error.details.error.stack);
    assert.equal(entries.filter(row => row.level === "error" && row.details?.error?.message === error.message).length,1);
  }
  assert.equal(parseEntry.details.error.diagnostic.line,6);
  assert.equal(workerEntry.details.operation,"reconvergence.run");
  assert.ok(workerEntry.details.jobId && workerEntry.details.sessionId);
  const disk = await terminalErrors(join(dir,"logs"));
  const inputEntry = correlate(disk,missing,{documentVersion:pair.documentVersion,documentId:pair.documentId,side:"B"},"timing open");
  const outputEntry = correlate(disk,output,graphScope,"svg export");
  for (const [entry,receipt] of [[inputEntry,missing],[outputEntry,output]]) assert.equal(entry.details.code,receipt.error.code);
  const evidence = JSON.stringify([disk,entries,parsed,worker,missing,output]);
  assert.ok(!evidence.includes(sourceMarker) && !evidence.includes(secretMarker),"Input content leaked into diagnostics");
  return {input:inputEntry.details.code,output:outputEntry.details.code,parser:parsed.error.code,worker:workerEntry.details.code,
    parserLine:6,workerStack:true,uniqueOwners:4,sourceRedacted:true};
}
