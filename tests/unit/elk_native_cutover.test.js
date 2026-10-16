import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {getLayoutProvider,listLayoutProviders} from '../../src/layout/layoutProvider.js';
import {DEFAULT_LAYOUT_PROVIDER_ID,FALLBACK_LAYOUT_PROVIDER_ID} from '../../src/layout/providerDefaults.js';
import {createAppState} from '../../src/app/appState.js';
import {DEFAULT_LAYOUT_POLICY} from '../../src/layout/layoutPolicy.js';

test('product H08 has one registry identity and no retired or research runtime imports',async()=>{
  assert.equal(getLayoutProvider().id,'native-layered');
  assert.equal(listLayoutProviders().filter(p=>p.id==='native-layered').length,1);
  assert.equal(getLayoutProvider('native-layered').profile,'h08');
  assert.equal(getLayoutProvider('native-layered').executionMode,'async');
  assert.equal(getLayoutProvider('elk-layered').executionMode,'async');
  assert.equal(getLayoutProvider().executionMode,'async');
  assert.notEqual(getLayoutProvider('simple-layered').executionMode,'async');
  const root=new URL('../../src/',import.meta.url);
  async function inspect(directory){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const file=new URL(entry.name+(entry.isDirectory()?'/':''),directory);
      if(entry.isDirectory()){
        assert.notEqual(entry.name,'native_layered','retired algorithms must not ship under src');
        await inspect(file);
      }else if(entry.name.endsWith('.js')){
        const source=await readFile(file,'utf8');
        for(const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)){
          assert.doesNotMatch(match[1],/retired_native_layered|native_layered\/|tools\/research|node:/,file.pathname);
        }
      }
    }
  }
  await inspect(root);
});

test('Single and Compare schedule declared async providers rather than special-casing ELK identity',async()=>{
  const source=await readFile(new URL('../../src/app/main.js',import.meta.url),'utf8');
  assert.match(source,/compareLayoutProvider\.executionMode === "async"/);
  assert.match(source,/layoutProvider\.executionMode === "async"/);
  assert.doesNotMatch(source,/layoutProvider\.id === "elk-layered"|compareLayoutProvider\.id === "elk-layered"/);
});

test('session initialization can render pending stats before an async provider publishes its first graph',async()=>{
  const source=await readFile(new URL('../../src/app/main.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('function renderStats() {'),source.indexOf('\nfunction signed('));
  const state={compare:{active:false},currentModule:{displayName:'restored'},graph:null};
  const elements={stats:{innerHTML:null}};
  const context={state,elements,statsRows:rows=>rows};
  runInNewContext(`${body}\nrenderStats();`,context);
  assert.equal(elements.stats.innerHTML[1][1],'Pending');
  state.graph={stats:{ports:1,nets:1,cells:0,assigns:0},nodes:[{}],edges:[]};
  runInNewContext('renderStats();',context);
  assert.equal(elements.stats.innerHTML.find(row=>row[0]==='Graph nodes')[1],1);
});

test('app, registry and EDA startup share H08 default while explicit legacy choice and Simple fallback remain',async()=>{
  const source=await readFile(new URL('../../src/app/main.js',import.meta.url),'utf8');
  assert.equal(createAppState(DEFAULT_LAYOUT_POLICY).layoutProviderId,DEFAULT_LAYOUT_PROVIDER_ID);
  assert.equal(getLayoutProvider().id,DEFAULT_LAYOUT_PROVIDER_ID);
  assert.equal(getLayoutProvider('unknown-provider').id,FALLBACK_LAYOUT_PROVIDER_ID);
  assert.equal(getLayoutProvider('simple-layered').id,'simple-layered');
  const handler=source.slice(source.indexOf('function createStartupHandlers() {'),source.indexOf('\nfunction startSidebarResize('));
  const elements={layoutProviderSelect:{},faninDepthInput:{},fanoutDepthInput:{}};
  const state={layoutProviderId:'simple-layered',faninDepth:3,fanoutDepth:3};
  runInNewContext(`${handler}\ncreateStartupHandlers().configureTarget({faninDepth:2});`,{
    state,elements,DEFAULT_LAYOUT_PROVIDER_ID,selectStartupModule(){},focusStartupCell(){},focusStartupCells(){}
  });
  assert.equal(state.layoutProviderId,DEFAULT_LAYOUT_PROVIDER_ID);
  assert.equal(elements.layoutProviderSelect.value,DEFAULT_LAYOUT_PROVIDER_ID);
  assert.equal(state.faninDepth,2);
  assert.match(source,/state\.layoutProviderId = getSessionLayoutProviderId\(session\)/);
  const failure=source.slice(source.indexOf('function handleLayoutFailure('),source.indexOf('\nfunction ',source.indexOf('function handleLayoutFailure(')+10));
  assert.match(failure,/getNextLayoutProviderId\(state\.layoutProviderId\)/);
});
