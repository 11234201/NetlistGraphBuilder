import assert from "node:assert/strict";
import {join} from "node:path";

export async function verifyPickerAndClipboard({run, page, project}) {
  async function ok(...args) {
    const receipt = await run(...args);
    assert.equal(receipt.status, "committed", JSON.stringify(receipt));
    return receipt.result;
  }
  const dialog = page.locator("dialog").filter({has:page.locator("[data-roots]")});
  await ok("files", "browse", "--dir", join(project, "tests", "fixtures"));
  assert.equal(await dialog.locator("[data-roots]").inputValue(), project);
  await dialog.locator("[data-up]").click();
  await page.waitForFunction(expected =>
    document.querySelector("dialog[open] [data-path]")?.value === expected, join(project, "tests"));
  await ok("files", "cancel");

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const endpoint = "**/__ngb/workbench";
  const holdListing = async route => {
    if (route.request().postDataJSON()?.op === "list") await gate;
    await route.continue();
  };
  await page.route(endpoint, holdListing);
  try {
    const listing = page.waitForRequest(req => req.method() === "POST" &&
      new URL(req.url()).pathname === "/__ngb/workbench" && req.postDataJSON().op === "list");
    const browsing = run("files", "browse", "--dir", project);
    await listing;
    await dialog.locator("[data-cancel]").click();
    release();
    const receipt = await browsing;
    assert.equal(receipt.status, "cancelled", "Closing the dialog superseded its pending directory listing");
    assert.equal(receipt.error.code, "CANCELLED");
    assert.ok(!(await ok("log","list","--level","error")).some(entry => entry.details?.requestId === receipt.requestId));
  } finally {
    release();
    await page.unroute(endpoint, holdListing);
  }

  await ok("design", "open", "--text", "module before_copy(input a,output y); assign y=a; endmodule", "--name", "before.v");
  const before = await ok("design", "info");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {configurable:true, value:{
      writeText:() => new Promise((resolve,reject) => {
        window.rejectReviewCopy = () => reject(new DOMException("Review clipboard permission denied", "NotAllowedError"));
      })
    }});
  });
  try {
    const copying = run("log", "copy", "--clipboard");
    await page.waitForFunction(() => typeof window.rejectReviewCopy === "function");
    await page.locator("#fileInput").setInputFiles({name:"after.v",mimeType:"text/plain",
      buffer:Buffer.from("module after_copy(input b,output z); assign z=b; endmodule")});
    await page.waitForFunction(() => document.getElementById("moduleHierarchyCurrent").textContent.includes("after_copy"));
    await page.evaluate(() => window.rejectReviewCopy());
    const receipt = await copying;
    assert.equal(receipt.error?.code, "COPY_FAILED");
    assert.equal(receipt.error.details.error.cause.name, "NotAllowedError");
    assert.equal(receipt.error.details.documentVersion, before.documentVersion);
    assert.doesNotMatch(await page.locator("#statusBar").textContent(), /Review clipboard/);
    const failures = (await ok("log","list","--level","error","--phase","export"))
      .filter(entry => entry.details?.requestId === receipt.requestId);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].details.moduleName, "before_copy");
    assert.equal(failures[0].details.error.cause.name, "NotAllowedError");
    assert.equal((await ok("design","info")).moduleName, "after_copy");
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => { throw new DOMException("Copy aborted","AbortError"); };
    });
    const aborted = await run("log","copy","--clipboard");
    assert.equal(aborted.status,"cancelled");
    assert.equal(aborted.error.code,"CANCELLED");
    assert.ok(!(await ok("log","list","--level","error")).some(entry => entry.details?.requestId === aborted.requestId));
  } finally {
    await page.evaluate(() => {
      window.rejectReviewCopy?.();
      delete window.rejectReviewCopy;
      delete navigator.clipboard;
    });
  }
  return {parentDirectory:true, cancelledListing:true, clipboardError:"COPY_FAILED", originalModule:"before_copy"};
}
