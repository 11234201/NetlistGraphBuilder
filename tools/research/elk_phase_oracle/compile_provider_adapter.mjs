import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {measureLegacyLayoutGraph,restoreLegacyLayoutGraph} from '../../../src/layout/legacy_measurement.js';

// Compile the neutral provider body while preserving the original raw-input
// research harness API. Production measurement never runs through this helper.
export async function compileProviderAdapter(indexUrl){
  const location=new URL('../../../src/layout/measured_anchor_layout.js',import.meta.url);
  let source=await readFile(location,'utf8');
  const anchor="from './anchor_layered/index.js'";
  assert.equal(source.split(anchor).length,2,'missing or ambiguous provider phase anchor');
  source=source.replace(anchor,`from '${indexUrl}'`)
    .replace(/from ['"](\.{1,2}\/[^'"]+)['"]/g,(_,relative)=>`from '${new URL(relative,location).href}'`);
  const Core=(await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).MeasuredAnchorLayoutProvider;
  return class ResearchProvider extends Core {
    constructor(...args){super(...args);this.measurementContract=null;}
    async layout(graph,options={}){
      const measured=measureLegacyLayoutGraph(graph,{cellPinPitch:options.layoutPolicy?.spacing?.cellPinPitch,focusedOrderGroups:true});
      return restoreLegacyLayoutGraph(await this.layoutMeasured(measured,options),graph);
    }
  };
}
