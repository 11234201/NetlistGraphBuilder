import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {getLayoutProvider} from '../../src/layout/layoutProvider.js';
import {DEFAULT_LAYOUT_PROVIDER_ID,getNextLayoutProviderId} from '../../src/layout/providerDefaults.js';
import {createAppState} from '../../src/app/appState.js';
import {DEFAULT_LAYOUT_POLICY} from '../../src/layout/layoutPolicy.js';
import {createSessionSnapshot,getSessionLayoutProviderId} from '../../src/app/sessionState.js';

test('H08 is default; old Simple snapshots migrate once, new explicit choices survive',()=>{
  assert.equal(getSessionLayoutProviderId(null),DEFAULT_LAYOUT_PROVIDER_ID);
  assert.equal(getSessionLayoutProviderId({layoutProviderId:'simple-layered'}),DEFAULT_LAYOUT_PROVIDER_ID);
  assert.equal(getSessionLayoutProviderId({layoutProviderId:'invalid'}),DEFAULT_LAYOUT_PROVIDER_ID);
  assert.equal(getSessionLayoutProviderId({layoutProviderId:'elk-layered'}),'elk-layered');
  const state=createAppState(DEFAULT_LAYOUT_POLICY);
  state.layoutProviderId='simple-layered';
  assert.equal(getSessionLayoutProviderId(createSessionSnapshot(state)),'simple-layered');
  state.layoutFallbackFromProviderId=DEFAULT_LAYOUT_PROVIDER_ID;
  assert.equal(getSessionLayoutProviderId(createSessionSnapshot(state)),DEFAULT_LAYOUT_PROVIDER_ID);
});

for(const compare of [false,true]){
  test(`shared failure handler degrades H08 -> ELK -> Simple once, compare=${compare}`,async()=>{
    const source=await readFile(new URL('../../src/app/main.js',import.meta.url),'utf8');
    const start=source.indexOf('function handleLayoutFailure(');
    const body=source.slice(start,source.indexOf('\nfunction ',start+10));
    const state={layoutProviderId:DEFAULT_LAYOUT_PROVIDER_ID,compare:{active:compare}};
    const calls=[],logs=[],elements={layoutProviderSelect:{}};
    const context={state,elements,getLayoutProvider,getNextLayoutProviderId,
      logProcess:(...args)=>logs.push(args),setStatus(){},
      renderCurrentModuleGraph:()=>calls.push('single'),renderCompareGraphs:()=>calls.push('compare')};
    runInNewContext(body,context);
    runInNewContext('handleLayoutFailure({name:"AbortError",message:"cancelled"})',context);
    assert.equal(calls.length,0);
    for(const expected of ['elk-layered','simple-layered']){
      runInNewContext('handleLayoutFailure(new Error("test failure"))',context);
      assert.equal(state.layoutProviderId,expected);
      assert.equal(elements.layoutProviderSelect.value,expected);
      assert.equal(state.layoutFallbackFromProviderId,DEFAULT_LAYOUT_PROVIDER_ID);
    }
    runInNewContext('handleLayoutFailure(new Error("final failure"))',context);
    assert.deepEqual(calls,[compare?'compare':'single',compare?'compare':'single']);
    assert.equal(logs.length,3);
    assert.match(logs.at(-1)[2],/no fallback remains/);
  });
}
