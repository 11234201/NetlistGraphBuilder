import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.NGB_PLAYWRIGHT_MODULE || 'playwright');
const root=fileURLToPath(new URL('../..',import.meta.url));
const server=spawn(process.execPath,['tools/serve.mjs','--no-browser','--port','0'],{cwd:root,stdio:['ignore','pipe','pipe']});
let browser;
try {
 const url=await new Promise((resolve,reject)=>{let output='';server.stdout.on('data',chunk=>{output+=chunk;for(const line of output.split('\n')){try{const ready=JSON.parse(line);if(ready.event==='ready')resolve(ready.url);}catch{}}});server.on('error',reject);server.on('exit',code=>reject(new Error('server exited '+code)));});
 browser=await chromium.launch({headless:true,executablePath:process.env.NGB_CHROME,args:['--no-sandbox']});
 const page=await browser.newPage();const errors=[];let workers=0;
 page.on('pageerror',error=>errors.push(error.message));page.on('worker',()=>workers++);
 await page.goto(url);
 try { await page.locator('#schematicMount svg').waitFor({timeout:30000}); }
 catch (error) { throw new Error(`${error.message}\nPage errors: ${errors.join(' | ')}`); }

 const workflowSource='module top(input a, output y, output z); wire n; assign n=a; BUF u_migrate (.A(n),.Y(y)); INV u_top_other (.A(a),.Y(z)); endmodule\nmodule alt(input a, output y, output z); BUF u_alt (.A(a),.Y(y)); INV u_alt_other (.A(a),.Y(z)); endmodule';
 await page.locator('#fileInput').setInputFiles({name:'migration.v',mimeType:'text/plain',buffer:Buffer.from(workflowSource)});
 await page.locator('#schematicMount [data-node-id="cell:u_migrate"]').first().waitFor();
 await page.locator('#showAliasesInput').evaluate(input=>{input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.locator('#schematicMount [data-node-id="assign:n:a"]').first().waitFor();
 await page.locator('#schematicMount [data-node-id="cell:u_migrate"]').first().click({force:true});
 await page.locator('#setFocusedRootButton').evaluate(button=>button.click());
 await page.locator('#focusedViewButton.is-active').waitFor();
 await page.locator('#wholeViewButton').evaluate(button=>button.click());
 await page.locator('#wholeViewButton.is-active').waitFor();
 await page.locator('#moduleBackButton').evaluate(button=>button.click());
 await page.locator('#focusedViewButton.is-active').waitFor();
 await page.locator('#moduleForwardButton').evaluate(button=>button.click());
 await page.locator('#wholeViewButton.is-active').waitFor();
 await page.locator('#adjustLayoutButton').evaluate(button=>button.click());
 const nodeBox=await page.locator('#schematicMount [data-node-id="cell:u_migrate"]').first().boundingBox();
 assert.ok(nodeBox);
 const x=nodeBox.x+nodeBox.width/2,y=nodeBox.y+nodeBox.height/2;
 await page.mouse.move(x,y);await page.mouse.down();
 await page.mouse.move(x+40,y+25,{steps:5});await page.mouse.up();
 await page.waitForFunction(()=>document.querySelector('#statusBar').textContent.includes('Layout overrides:'));
 let goldenPath,goldenBeforeImport;
 for(const id of ['saveGoldenButton','exportSvgButton']){
  const download=page.waitForEvent('download');
  await page.locator('#'+id).evaluate(button=>button.click());
  const artifact=await download;assert.ok(artifact.suggestedFilename().endsWith(id==='saveGoldenButton'?'.json':'.svg'));
  const artifactPath=await artifact.path();
  const content=await readFile(artifactPath,'utf8');
  if(id==='saveGoldenButton') {
   goldenPath=artifactPath;
   const golden=JSON.parse(content);
   goldenBeforeImport=golden;
   assert.equal(golden.unitId,'top');
   assert.ok(golden.nodes.some(node=>node.id==='cell:u_migrate'));
   assert.ok(golden.diff.movedNodeCount>0);
  } else {
   assert.match(content,/<svg\b/);
   assert.match(content,/u_migrate/);
  }
 }
 await page.locator('#goldenInput').setInputFiles(goldenPath);
 await page.waitForFunction(()=>document.querySelector('#statusBar').textContent.includes('Loaded Golden'));
 const roundTripDownload=page.waitForEvent('download');
 await page.locator('#saveGoldenButton').evaluate(button=>button.click());
 const roundTripArtifact=await roundTripDownload;
 const goldenAfterImport=JSON.parse(await readFile(await roundTripArtifact.path(),'utf8'));
 const beforeNode=goldenBeforeImport.nodes.find(node=>node.id==='cell:u_migrate');
 const afterNode=goldenAfterImport.nodes.find(node=>node.id==='cell:u_migrate');
 assert.deepEqual({x:afterNode.x,y:afterNode.y,width:afterNode.width,height:afterNode.height},
  {x:beforeNode.x,y:beforeNode.y,width:beforeNode.width,height:beforeNode.height});
 await page.locator('#compareButton').evaluate(button=>button.click());
 await page.locator('#leftModuleSelect').selectOption('top');
 await page.locator('#rightModuleSelect').selectOption('alt');
 await page.locator('#applyCompareButton').evaluate(button=>button.click());
 await page.locator('#leftSchematicMount svg').waitFor();await page.locator('#rightSchematicMount svg').waitFor();
 assert.equal(await page.locator('#exportSvgButton').isDisabled(),true);
 await page.locator('#compareOutputSelect').selectOption('y');
 await page.waitForFunction(()=>document.querySelector('#statusBar').textContent.includes('Compare ready'));
 assert.equal(await page.locator('#leftSchematicMount [data-node-id="cell:u_top_other"]').count(),0);
 assert.equal(await page.locator('#rightSchematicMount [data-node-id="cell:u_alt_other"]').count(),0);
 await page.locator('#fitButton').evaluate(button=>button.click());
 await page.locator('#exitCompareButton').evaluate(button=>button.click());
 await page.locator('#schematicMount [data-node-id="cell:u_migrate"]').first().waitFor();
 assert.equal(await page.locator('#exportSvgButton').isDisabled(),false);
 console.log(JSON.stringify({workflow:'import-alias-focus-history-drag-golden-exports-compare-output',errors}));
 const result=await page.evaluate(async()=>{
  const {parseVerilog}=await import('/src/parser/verilogParser.js');
  const {buildSchematicGraph}=await import('/src/netlist/graph.js');
  const {getLayoutProvider}=await import('/src/layout/layoutProvider.js');
  const provider=getLayoutProvider('native-layered');
  const graph=buildSchematicGraph(parseVerilog('module top(input a, output y); BUF u (.A(a),.Y(y)); endmodule').modules[0]);
  const workerResult=await provider.layout(graph);
  const directResult=await provider.layout(graph,{nativeLayered:{yieldControl:()=>Promise.resolve()}});
  const cells=Array.from({length:1000},(_,i)=>`BUF u${i} (.A(${i===0?'a':'n'+(i-1)}),.Y(${i===999?'y':'n'+i}));`).join('\n');
  const large=buildSchematicGraph(parseVerilog(`module top(input a, output y); ${cells} endmodule`).modules[0]);
  const controller=new AbortController();let timerFired=false;
  setTimeout(()=>{timerFired=true;controller.abort();},10);
  const started=performance.now();let outcome;
  try{await provider.layout(large,{signal:controller.signal});outcome='completed';}catch(error){outcome=error.name;}
  return {equal:JSON.stringify(workerResult)===JSON.stringify(directResult),outcome,timerFired,cancelMs:performance.now()-started,status:workerResult.layoutStatus};
 });
 assert.equal(result.equal,true);assert.equal(result.outcome,'AbortError');assert.equal(result.timerFired,true);assert.equal(result.status,'routed');assert.deepEqual(errors,[]);assert.ok(workers>=2);
 console.log(JSON.stringify({...result,workers,errors}));
} finally {await browser?.close();server.kill();}
