import assert from 'node:assert/strict';
import test from 'node:test';
import {getLayoutProvider} from '../../src/layout/layoutProvider.js';
import {DEFAULT_LAYOUT_PROVIDER_ID} from '../../src/layout/providerDefaults.js';
import {createAppState} from '../../src/app/appState.js';
import {DEFAULT_LAYOUT_POLICY} from '../../src/layout/layoutPolicy.js';
import {createSessionSnapshot,getSessionLayoutProviderId} from '../../src/app/sessionState.js';
import {createWorkspaceRenderController} from '../../src/app/workspace_render_controller.js';

test('AnchorLayered is default; old Simple snapshots migrate once, new explicit choices survive',()=>{
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
  test(`shared failure handler degrades AnchorLayered -> ELK -> Simple once, compare=${compare}`,async()=>{
    const state=createAppState(DEFAULT_LAYOUT_POLICY);
    state.compare.active=compare;
    state.currentModule={name:'top',displayName:'top'};
    state.design={modules:[state.currentModule]};
    const calls=[],logs=[],elements={layoutProviderSelect:{}};
    const services={
      logProcess:(...args)=>logs.push(args),setStatus(){},
      renderCompareGraphs:()=>calls.push('compare'),
      getCurrentLayoutProvider:()=>getLayoutProvider(state.layoutProviderId),
      renderGeneration:{begin:()=>({id:1,isCurrent:()=>true})},
      workspaceExecution:{execute:()=>calls.push('single')},
      singleViewSession:{beginComputation:()=>({sessionId:'single:primary'})}
    };
    const controller=createWorkspaceRenderController({state,elements,services});
    controller.handleLayoutFailure({name:'AbortError',message:'cancelled'});
    assert.equal(calls.length,0);
    for(const expected of ['elk-layered','simple-layered']){
      controller.handleLayoutFailure(new Error('test failure'));
      assert.equal(state.layoutProviderId,expected);
      assert.equal(elements.layoutProviderSelect.value,expected);
      assert.equal(state.layoutFallbackFromProviderId,DEFAULT_LAYOUT_PROVIDER_ID);
    }
    controller.handleLayoutFailure(new Error('final failure'));
    assert.deepEqual(calls,[compare?'compare':'single',compare?'compare':'single']);
    const failures=logs.filter(([level])=>level==='error');
    assert.equal(failures.length,3);
    assert.match(failures.at(-1)[2],/no fallback remains/);
  });
}
