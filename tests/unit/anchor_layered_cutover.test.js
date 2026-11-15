import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {DEFAULT_LAYOUT_PROVIDER_ID} from '../../src/layout/providerDefaults.js';
import {createAppState} from '../../src/app/appState.js';
import {DEFAULT_LAYOUT_POLICY} from '../../src/layout/layoutPolicy.js';
import {createInspectorController} from '../../src/app/inspector_controller.js';
import {createInputController} from '../../src/app/input_controller.js';
import {createTestViewBridges} from '../helpers/view_session_bridges.js';

test('session initialization can render pending stats before an async provider publishes its first graph',async()=>{
  const state={compare:{active:false},currentModule:{displayName:'restored'},graph:null};
  const elements={stats:{innerHTML:null}};
  const controller=createInspectorController({state,elements,services:{}});
  controller.renderStats();
  assert.match(elements.stats.innerHTML,/Pending/);
  state.graph={stats:{ports:1,nets:1,cells:0,assigns:0},nodes:[{}],edges:[]};
  controller.renderStats();
  assert.match(elements.stats.innerHTML,/Graph nodes/);
  assert.match(elements.stats.innerHTML,/>1</);
});

test('EDA startup selects the product default and session restore uses the migration boundary',async()=>{
  assert.equal(createAppState(DEFAULT_LAYOUT_POLICY).layoutProviderId,DEFAULT_LAYOUT_PROVIDER_ID);
  const elements={layoutProviderSelect:{},faninDepthInput:{},fanoutDepthInput:{}};
  const state={...createAppState(DEFAULT_LAYOUT_POLICY),layoutProviderId:'simple-layered',faninDepth:3,fanoutDepth:3};
  createInputController({state,elements,services:createTestViewBridges(state)}).createStartupHandlers().configureTarget({faninDepth:2});
  assert.equal(state.layoutProviderId,DEFAULT_LAYOUT_PROVIDER_ID);
  assert.equal(elements.layoutProviderSelect.value,DEFAULT_LAYOUT_PROVIDER_ID);
  assert.equal(state.faninDepth,2);
  const source=await readFile(new URL('../../src/app/preferences_controller.js',import.meta.url),'utf8');
  assert.match(source,/state\.layoutProviderId = getSessionLayoutProviderId\(session\)/);
});
