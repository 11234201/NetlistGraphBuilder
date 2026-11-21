import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function processLog(page) {
  const download=page.waitForEvent("download");
  await page.locator("#exportProcessLogButton").evaluate(button=>button.click());
  return (await readFile(await (await download).path(),"utf8")).trim().split(/\r?\n/).map(JSON.parse);
}

export async function verifyCollectionViews({graph,base,eco,ok,inputs,until}) {
  const popup=graph.waitForEvent("popup");
  await graph.evaluate(()=>{window.open(location.href,"_blank");});
  const clone=await popup;
  try{
    await clone.locator("#remotePageLabel").waitFor({state:"visible"});
    const id=(await clone.locator("#remotePageLabel").innerText()).trim().split(" ")[0];
    const modules=()=>ok("--page",id,"module","list");
    const select=key=>ok("--page",id,"module","open",key);
    const view=(key)=>clone.evaluate(key=>{
      const data=JSON.parse(sessionStorage.getItem("ngb.aig-collection.v1"));
      return data?.records.find(r=>r.id===key)?.view;
    },key);
    assert.equal((await modules()).length,3);
    await select(base.id);
    const node=clone.locator("#schematicMount [data-aig-node]").first();
    await node.focus();await node.press("Enter");
    await clone.locator("#focusedViewButton").click();
    const focused=await until(async()=>{
      const state=await view(base.id);return state.focus?.focusedRootNodeIds.length && state.focus;
    },"set Focused root on base graph");
    await select(eco.id);
    if(!await clone.locator("#pathPanel").isVisible())await clone.locator("#showPathButton").click();
    async function endpoint(term,side) {
      await clone.locator("#pathFind").fill(term);
      await clone.locator("#pathCandidates .path-row").filter({hasText:term}).first().locator('[data-path-action="'+side+'"]').click();
    }
    await endpoint("n0","starts");
    await endpoint("z_eco","ends");
    await clone.locator('#pathPanel [data-path-action="apply"]').click();
    const path=await until(async()=>{
      const state=await view(eco.id);return state.focus?.showPath?.enabled && state.focus.showPath;
    },"enable Show Path on eco graph");
    await clone.reload();await clone.locator("#remotePageLabel").waitFor({state:"visible"});
    assert.equal((await clone.locator("#remotePageLabel").innerText()).trim().split(" ")[0],id);
    assert.equal((await modules()).find(g=>g.active).id,eco.id);
    assert.deepEqual((await view(eco.id)).focus.showPath,path);
    assert.ok(await clone.locator("#pathPanel[data-enabled]").count());
    await select(base.id);
    const current=await view(base.id);
    assert.deepEqual(current.focus.focusedRootNodeIds,focused.focusedRootNodeIds);
    assert.ok(!current.focus.showPath?.enabled);
    await select(eco.id);
    assert.deepEqual((await view(eco.id)).focus.showPath,path);
    const legacy = await clone.evaluate(({base,eco}) => {
      const manifest=JSON.parse(sessionStorage.getItem("ngb.aig-collection.v1"));
      return [base,eco].map((id,index)=>{
        const record=manifest.records.find(r=>r.id===id);
        return {...record.view, kind:"domain-workspace", domainId:"aig", normalizationVersion:1,
          version:index+1, source:JSON.parse(sessionStorage.getItem("ngb.aig-source."+id)),
          ...(index===1 && {sourceIdentity:record.identity})};
      });
    },{base:base.id,eco:eco.id});
    // Count real source-record writes while the viewport changes.
    const originalScale=(await view(eco.id)).viewport.scale;
    await clone.evaluate(()=>{
      window.sourceWrites=0;
      window.failArchive=false;
      const original=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){
        if(key.startsWith("ngb.aig-source."))window.sourceWrites++;
        if(window.failArchive && key.startsWith("ngb.aig-collection.")){
          const error=new DOMException("Acceptance quota reached","QuotaExceededError");
          window.originalQuotaStack=error.stack;
          throw error;
        }
        return original.call(this,key,value);
      };
    });
    const shape=await clone.locator("#schematicMount [data-aig-node]").first().boundingBox();
    await clone.mouse.move(shape.x+shape.width/2,shape.y+shape.height/2);
    await clone.mouse.wheel(0,-120);
    await until(async()=>(await view(eco.id)).viewport.scale!==originalScale,"commit new viewport");
    assert.equal(await clone.evaluate(()=>window.sourceWrites),0);
    await clone.evaluate(()=>{window.failArchive=true;});
    const more=await ok("--page",id,"aig","add",inputs+"/shared_cone.dot");
    assert.equal(more.graphCount,4);
    assert.equal((await modules()).length,4);
    const sourceAvailable=await ok("--page",id,"search","find","z_eco");
    assert.ok(sourceAvailable.length);
    const entries=await processLog(clone);
    const quota=entries.find(e=>e.level==="warning" && e.details?.code==="aig.workspace.save.failed" && e.details.error?.name==="QuotaExceededError");
    const warnings=entries.filter(e=>e.phase==="persistence" || e.details?.operation==="aig.workspace.save")
      .map(e=>({level:e.level,code:e.details?.code,error:e.details?.error?.name,message:e.message}));
    assert.equal(quota?.details.error.message,"Acceptance quota reached","Quota failure has structured diagnostic details: "+JSON.stringify(warnings));
    const originalStack=await clone.evaluate(()=>window.originalQuotaStack);
    if(originalStack) assert.equal(quota.details.error.stack,originalStack);
    assert.equal(await clone.evaluate(()=>sessionStorage.getItem("ngb.aig-collection.v1")),null);
    await clone.reload();await clone.locator("#remotePageLabel").waitFor({state:"visible"});
    const context=await ok("--page",id,"design","info");
    assert.notEqual(context.mode,"AIG");
    // Seed a legacy archive at navigation start, after the outgoing page has persisted its state.
    await clone.addInitScript(() => {
      const seed=sessionStorage.getItem("ngb.acceptance.legacy");
      if (!seed) return;
      sessionStorage.removeItem("ngb.acceptance.legacy");
      for (const key of Object.keys(sessionStorage)) if (key.startsWith("ngb.aig-")) sessionStorage.removeItem(key);
      sessionStorage.setItem("ngb.domain-workspace.v1",seed);
    });
    for(const archived of legacy) {
      await clone.evaluate(record=>sessionStorage.setItem("ngb.acceptance.legacy",JSON.stringify(record)),archived);
      await clone.reload();
      await clone.locator("#remotePageLabel").waitFor({state:"visible"});
      const restored=await modules();
      assert.equal(restored.length,1);
      assert.equal(restored[0].active,true);assert.equal(restored[0].name,archived.source.name);
      if (archived.version===2) assert.ok(await clone.locator("#pathPanel[data-enabled]").count());
    }
    return {legacyVersions:[1,2],focusedRoots:focused.focusedRootNodeIds,showPathRestored:true,sourceWritesOnZoom:0,
      inMemoryGraphsAfterQuota:4,quotaCode:quota.details.code,restoredOldCollection:false};
  } finally {await clone.close();}
}
