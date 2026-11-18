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
 const clickVisible = async (selector) => {
  const target = page.locator(selector);
  for (const menu of await target.locator('xpath=ancestor::details').all()) {
   if (!await menu.evaluate(element=>element.open)) await menu.locator(':scope > summary').click();
  }
  await target.click();
 };
 const waitSingleQuery = async (expected) => page.waitForFunction((query)=>{
  const saved=JSON.parse(sessionStorage.getItem('netlistGraphBuilder.session.v2') || 'null');
  return Object.entries(query).every(([key,value])=>saved?.[key]===value)
   && !document.querySelector('#saveGoldenButton').disabled
   && /^(Ready|Focused neighborhood root|Loaded Golden)/.test(document.querySelector('#statusBar').textContent);
 },expected);
 const readGolden = async () => {
  const download=page.waitForEvent('download');
  await clickVisible('#saveGoldenButton');
  const artifact=await download;
  const path=await artifact.path();
  return {path,value:JSON.parse(await readFile(path,'utf8'))};
 };
 const nodeGeometry = (golden,id) => {
  const node=golden.nodes.find(item=>item.id===id);
  assert.ok(node,id);
  return {x:node.x,y:node.y,width:node.width,height:node.height};
 };
 const waitCompareDepth = async (depth,hasUpstream) => page.waitForFunction(({depth,hasUpstream})=>{
  const saved=JSON.parse(sessionStorage.getItem('netlistGraphBuilder.session.v2') || 'null');
  return saved?.coneDepth===depth && document.querySelector('#coneDepthInput').value===String(depth)
   && document.querySelector('#statusBar').textContent.includes('Compare ready')
   && Boolean(document.querySelector('#leftSchematicMount [data-node-id="cell:u_upstream"]'))===hasUpstream
   && Boolean(document.querySelector('#rightSchematicMount [data-node-id="cell:u_alt_upstream"]'))===hasUpstream;
 },{depth,hasUpstream});
 page.on('pageerror',error=>errors.push(error.message));page.on('worker',()=>workers++);
 await page.goto(url);
 try { await page.locator('#schematicMount svg').waitFor({timeout:30000}); }
 catch (error) { throw new Error(`${error.message}\nPage errors: ${errors.join(' | ')}`); }

 // Node and Chrome expose different native Map APIs. Exercise the browser's
 // real upsert methods against committed Session and measured snapshots.
 const collectionChecks=await page.evaluate(async()=>{
  const {createViewSessionStore}=await import('/src/application/view_session_store.js');
  const {createMeasuredLayoutGraph}=await import('/src/contracts/measured_graph.js');
  const store=createViewSessionStore([{sessionId:'readonly-test',documentId:'d',domainId:'netlist',unitId:'m',
   overrides:{nodePositions:new Map([['existing',{x:1,y:2}]])}}]);
  const session=store.require('readonly-test');
  const measured=createMeasuredLayoutGraph({nodes:[{id:'n'}],edges:[]},
   {nodes:new Map([['n',{width:80,height:40,ports:[]}]])});
  const methods=['getOrInsert','getOrInsertComputed'].filter(name=>typeof Map.prototype[name]==='function');
  const checks=[];let callbackCalls=0;
  for(const map of [session.overrides.nodePositions,measured.measurements.nodes])for(const method of methods){
   for(const key of [...map.keys(),'new']){
    let rejected=false;
    try{map[method](key,method==='getOrInsertComputed'?()=>{callbackCalls++;return {x:99};}:{x:99});}
    catch(error){rejected=error instanceof TypeError && /read-only/.test(error.message);}
    checks.push(rejected);
   }
  }
  return {methods,checks,callbackCalls,sessionSize:session.overrides.nodePositions.size,
   measuredSize:measured.measurements.nodes.size,position:session.overrides.nodePositions.get('existing'),
   revision:store.require('readonly-test').computationRevision};
 });
 assert.ok(collectionChecks.checks.every(Boolean));assert.equal(collectionChecks.callbackCalls,0);
 assert.equal(collectionChecks.sessionSize,1);assert.equal(collectionChecks.measuredSize,1);
 assert.deepEqual(collectionChecks.position,{x:1,y:2});assert.equal(collectionChecks.revision,1);
 console.log(JSON.stringify({readonlyCollections:collectionChecks,browser:await browser.version()}));

 const workflowSource='module top(input a, output y, output z); wire n,b; assign n=a; BUF u_upstream (.A(n),.Y(b)); BUF u_migrate (.A(b),.Y(y)); INV u_top_other (.A(a),.Y(z)); endmodule\nmodule alt(input a, output y, output z); wire b; BUF u_alt_upstream (.A(a),.Y(b)); BUF u_alt (.A(b),.Y(y)); INV u_alt_other (.A(a),.Y(z)); endmodule';
 await page.locator('#fileInput').setInputFiles({name:'migration.v',mimeType:'text/plain',buffer:Buffer.from(workflowSource)});
 await page.locator('#schematicMount [data-node-id="cell:u_migrate"]').first().waitFor();
 await page.locator('#settingsMenu > summary').click();
 await page.locator('#viewMenu > summary').click();
 await page.locator('#showAliasesInput').check();
 await page.keyboard.press('Escape');
 await page.locator('#schematicMount [data-node-id="assign:n:a"]').first().waitFor();
 await page.locator('#schematicMount [data-node-id="cell:u_migrate"] .node-shape').first().click();
 await clickVisible('#setFocusedRootButton');
 await page.locator('#focusedViewButton.is-active').waitFor();
 await clickVisible('#wholeViewButton');
 await page.locator('#wholeViewButton.is-active').waitFor();
 await clickVisible('#moduleBackButton');
 await page.locator('#focusedViewButton.is-active').waitFor();
 await clickVisible('#moduleForwardButton');
 await page.locator('#wholeViewButton.is-active').waitFor();
 await clickVisible('#focusedViewButton');
 await waitSingleQuery({viewMode:'focused',faninDepth:3,fanoutDepth:3});
 await clickVisible('#faninDepthInput');
 await page.locator('#faninDepthInput').fill('0');
 await page.locator('#faninDepthInput').dispatchEvent('change');
 await waitSingleQuery({viewMode:'focused',faninDepth:0,fanoutDepth:3});
 assert.equal(await page.locator('#schematicMount [data-node-id="cell:u_upstream"]').count(),0);
 await clickVisible('#moduleBackButton');
 await waitSingleQuery({viewMode:'focused',faninDepth:3,fanoutDepth:3});
 await page.locator('#schematicMount [data-node-id="cell:u_upstream"]').first().waitFor();
 await clickVisible('#moduleForwardButton');
 await waitSingleQuery({viewMode:'focused',faninDepth:0,fanoutDepth:3});
 assert.equal(await page.locator('#schematicMount [data-node-id="cell:u_upstream"]').count(),0);
 await page.locator('#fanoutDepthInput').fill('2');
 await page.locator('#fanoutDepthInput').dispatchEvent('change');
 await waitSingleQuery({viewMode:'focused',faninDepth:0,fanoutDepth:2});
 await clickVisible('#moduleBackButton');
 await waitSingleQuery({viewMode:'focused',faninDepth:0,fanoutDepth:3});
 await clickVisible('#moduleForwardButton');
 await waitSingleQuery({viewMode:'focused',faninDepth:0,fanoutDepth:2});
 assert.equal(await page.locator('#faninDepthInput').inputValue(),'0');
 assert.equal(await page.locator('#fanoutDepthInput').inputValue(),'2');
 await clickVisible('#wholeViewButton');
 await page.locator('#wholeViewButton.is-active').waitFor();
 await waitSingleQuery({viewMode:'whole',faninDepth:0,fanoutDepth:2});
 const beforeDragGolden=(await readGolden()).value;
 await clickVisible('#adjustLayoutButton');
 const nodeBox=await page.locator('#schematicMount [data-node-id="cell:u_migrate"]').first().boundingBox();
 assert.ok(nodeBox);
 const x=nodeBox.x+nodeBox.width/2,y=nodeBox.y+nodeBox.height/2;
 await page.mouse.move(x,y);await page.mouse.down();
 await page.mouse.move(x+40,y+25,{steps:5});await page.mouse.up();
 await page.waitForFunction(()=>document.querySelector('#statusBar').textContent.includes('Layout overrides:'));
 let goldenPath,goldenBeforeImport;
 for(const id of ['saveGoldenButton','exportSvgButton']){
  const download=page.waitForEvent('download');
  await clickVisible('#'+id);
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
   assert.equal(golden.layoutOptions.display.faninDepth,0);
   assert.equal(golden.layoutOptions.display.fanoutDepth,2);
  } else {
   assert.match(content,/<svg\b/);
   assert.match(content,/u_migrate/);
  }
 }
 // A completed drag owns one operation, including its selection and reroute.
 // One Back must remove the override; one Forward must restore its geometry.
 await clickVisible('#moduleBackButton');
 await page.waitForFunction(()=>document.querySelector('#resetLayoutButton').disabled
  && !document.querySelector('#saveGoldenButton').disabled);
 const undoneGolden=(await readGolden()).value;
 assert.deepEqual(nodeGeometry(undoneGolden,'cell:u_migrate'),nodeGeometry(beforeDragGolden,'cell:u_migrate'));
 assert.equal(undoneGolden.diff.movedNodeCount,0);
 await clickVisible('#moduleForwardButton');
 await page.waitForFunction(()=>!document.querySelector('#resetLayoutButton').disabled
  && !document.querySelector('#saveGoldenButton').disabled);
 const redoneGolden=(await readGolden()).value;
 assert.deepEqual(nodeGeometry(redoneGolden,'cell:u_migrate'),nodeGeometry(goldenBeforeImport,'cell:u_migrate'));
 await page.locator('#goldenInput').setInputFiles(goldenPath);
 await page.waitForFunction(()=>document.querySelector('#statusBar').textContent.includes('Loaded Golden'));
 const roundTripDownload=page.waitForEvent('download');
 await clickVisible('#saveGoldenButton');
 const roundTripArtifact=await roundTripDownload;
 const goldenAfterImport=JSON.parse(await readFile(await roundTripArtifact.path(),'utf8'));
 const beforeNode=goldenBeforeImport.nodes.find(node=>node.id==='cell:u_migrate');
 const afterNode=goldenAfterImport.nodes.find(node=>node.id==='cell:u_migrate');
 assert.deepEqual({x:afterNode.x,y:afterNode.y,width:afterNode.width,height:afterNode.height},
  {x:beforeNode.x,y:beforeNode.y,width:beforeNode.width,height:beforeNode.height});
 for (const key of ['viewMode','coneDepth','faninDepth','fanoutDepth']) {
  assert.equal(goldenAfterImport.layoutOptions.display[key],goldenBeforeImport.layoutOptions.display[key]);
 }
 await clickVisible('#compareButton');
 await page.locator('#leftModuleSelect').selectOption('top');
 await page.locator('#rightModuleSelect').selectOption('alt');
 await clickVisible('#applyCompareButton');
 await page.locator('#leftSchematicMount svg').waitFor();await page.locator('#rightSchematicMount svg').waitFor();
 assert.equal(await page.locator('#exportSvgButton').isDisabled(),true);
 await page.locator('#compareOptionsMenu > summary').click();
 await page.locator('#compareOutputSelect').selectOption('y');
 await page.waitForFunction(()=>document.querySelector('#statusBar').textContent.includes('Compare ready'));
 assert.equal(await page.locator('#leftSchematicMount [data-node-id="cell:u_top_other"]').count(),0);
 assert.equal(await page.locator('#rightSchematicMount [data-node-id="cell:u_alt_other"]').count(),0);
 await clickVisible('#coneDepthInput');
 await page.locator('#coneDepthInput').fill('1');
 await page.locator('#coneDepthInput').dispatchEvent('change');
 await waitCompareDepth(1,false);
 await page.locator('#coneDepthInput').fill('2');
 await page.locator('#coneDepthInput').dispatchEvent('change');
 await waitCompareDepth(2,true);
 await clickVisible('#moduleBackButton');
 await waitCompareDepth(1,false);
 await clickVisible('#moduleForwardButton');
 await waitCompareDepth(2,true);
 await clickVisible('#fitButton');
 await clickVisible('#exitCompareButton');
 await page.locator('#schematicMount [data-node-id="cell:u_migrate"]').first().waitFor();
 // The retained Single SVG can precede its asynchronous workspace commit.
 await page.waitForFunction(()=>!document.querySelector('#exportSvgButton').disabled
  && !document.querySelector('#saveGoldenButton').disabled);
 assert.equal(await page.locator('#exportSvgButton').isDisabled(),false);
 // A persisted Focused view must import its roots before the destination graph
 // exists, then resolve canonical refs without a second user command.
 await page.locator('#schematicMount [data-node-id="cell:u_migrate"] .node-shape').first().click();
 await clickVisible('#setFocusedRootButton');
 await page.waitForFunction(()=>{
  const value=JSON.parse(sessionStorage.getItem('netlistGraphBuilder.session.v2') || 'null');
  return value?.viewMode==='focused' && value.focusedRootNodeIds?.includes('cell:u_migrate')
   && value.faninDepth===0 && value.fanoutDepth===2 && value.coneDepth===2;
 });
 await page.reload();
 await page.locator('#schematicMount [data-node-id="cell:u_migrate"]').first().waitFor();
 await page.locator('#focusedViewButton.is-active').waitFor();
 assert.equal(await page.locator('#faninDepthInput').inputValue(),'0');
 assert.equal(await page.locator('#fanoutDepthInput').inputValue(),'2');
 assert.equal(await page.locator('#coneDepthInput').inputValue(),'2');
 assert.equal(await page.locator('#schematicMount [data-node-id="cell:u_upstream"]').count(),0);
 await page.locator('[data-focused-root-activate="cell:u_migrate"][aria-pressed="true"]').first().waitFor({state:'attached'});
 await page.waitForFunction(()=>{
  const value=JSON.parse(sessionStorage.getItem('netlistGraphBuilder.session.v2') || 'null');
  return value?.focusedRootRefs?.some(ref=>ref.localId==='u_migrate' && ref.unitId==='top');
 });
 console.log(JSON.stringify({workflow:'import-alias-focus-history-drag-golden-exports-compare-output-session-reload',
  historyChecks:['fanin-single-undo','fanout-single-undo','drag-single-undo','compare-output-depth-single-undo'],errors}));
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
