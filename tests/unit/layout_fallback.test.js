import assert from 'node:assert/strict';
import test from 'node:test';
import {getLayoutProvider} from '../../src/layout/layoutProvider.js';
import {DEFAULT_LAYOUT_PROVIDER_ID} from '../../src/layout/providerDefaults.js';
import {createAppState} from '../../src/app/appState.js';
import {DEFAULT_LAYOUT_POLICY} from '../../src/layout/layoutPolicy.js';
import {createSessionSnapshot,getSessionLayoutProviderId} from '../../src/app/sessionState.js';
import {createWorkspaceRenderController} from '../../src/app/workspace_render_controller.js';
import {createTestViewBridges} from '../helpers/view_session_bridges.js';

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
    Object.assign(state.compare, { leftModuleName: "design-A", rightModuleName: "design-B" });
    state.currentModule={name:'top',displayName:'top'};
    state.design={modules:[state.currentModule]};
    const calls=[],logs=[],elements={layoutProviderSelect:{}};
    const services={
      ...createTestViewBridges(state),
      logProcess:(...args)=>logs.push(args),setStatus(){},
      renderCompareGraphs:()=>calls.push('compare'),
      getCurrentLayoutProvider:()=>getLayoutProvider(state.layoutProviderId),
      renderGeneration:{begin:()=>({id:1,isCurrent:()=>true})},
      workspaceExecution:{execute:()=>calls.push('single')}
    };
    const controller=createWorkspaceRenderController({state,elements,services});
    controller.handleLayoutFailure({name:'AbortError',message:'cancelled'});
    assert.equal(calls.length,0);
    for(const expected of ['elk-layered','simple-layered']){
      const failure = new Error('test failure');
      failure.diagnostic = { phase: 'p5', invariant: 'orthogonal', entityIds: ['cell:u'] };
      controller.handleLayoutFailure(failure, { requestId: 17 });
      const details = logs.filter(([level]) => level === 'error').at(-1)[3];
      assert.equal(details.error, failure);
      assert.equal(details.requestId, 17);
      assert.equal(details.view, compare ? 'compare' : 'single');
      if (compare) {
        assert.equal(details.leftModule, "design-A");
        assert.equal(details.rightModule, "design-B");
        assert.equal(details.moduleName, undefined);
      } else assert.equal(details.moduleName, "top");
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

test("provider rejection retains its original value when reporting fails", () => {
  const state = createAppState(DEFAULT_LAYOUT_POLICY);
  state.compare.active = true;
  const statuses = [], attempts = [];
  const services = {
    setStatus: message => statuses.push(message),
    logProcess(level, phase, message, details) {
      attempts.push(details);
      throw new Error("log unavailable");
    },
    renderCompareGraphs() { attempts.push(state.layoutProviderId); }
  };
  const controller = createWorkspaceRenderController({ state, elements: { layoutProviderSelect: {} }, services });
  controller.handleLayoutFailure(null, { requestId: 7 });
  assert.deepEqual(attempts.map(value => value?.code || value), ["layout.provider-failed", "elk-layered"]);
  assert.equal(attempts[0].error, null);
  assert.match(statuses[0], /null/);
  state.layoutProviderId = "simple-layered";
  controller.handleLayoutFailure("provider stopped", { onFailed: value => attempts.push(value) });
  assert.equal(attempts.at(-1), "provider stopped");
  assert.match(statuses.at(-1), /provider stopped/);
});
