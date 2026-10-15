import assert from 'node:assert/strict';
import {properInputFromOracle} from './upstream_proper_input.mjs';
import {freezeRecord} from '../../../src/layout/elk_native/protocol.js';
import {validateProperGraph} from '../../../src/layout/elk_native/validate_proper.js';

// Research-only fixed factorial controls. Never imports source array order into runtime.
export function initializationVariants(oracle,{portScope='all'}={}){
  assert.ok(['all','normal','dummy'].includes(portScope));
  const base=properInputFromOracle(oracle,{observedInitialization:false});
  const observed=properInputFromOracle(oracle),byId=new Map(observed.nodes.map(node=>[node.id,node]));
  assert.equal(base.inputDigest,observed.inputDigest);
  return Array.from({length:8},(_,mask)=>{
    const layers=mask&1?observed.layers:base.layers;
    const positions=new Map(layers.flatMap(layer=>layer.nodeIds.map((id,order)=>[id,order])));
    const nodes=base.nodes.map(node=>{
      const source=byId.get(node.id),portsById=new Map(node.ports.map(port=>[port.id,port]));
      const usePorts=Boolean(mask&2)&&(portScope==='all'||(portScope==='dummy')===(node.kind==='long_edge'));
      const portOrder=usePorts?source.ports:node.ports;
      const observedPorts=new Map(source.ports.map(port=>[port.id,port]));
      const ports=portOrder.map(port=>{
        const original=portsById.get(port.id),geometry=mask&4?observedPorts.get(port.id):original;
        assert.ok(original&&geometry);
        return {...original,x:geometry.x,y:geometry.y,width:geometry.width,height:geometry.height,
          anchor:{...geometry.anchor},order:usePorts?port.order:original.order};
      });
      return {...node,order:positions.get(node.id),ports,...(mask&4?
        {width:source.width,height:source.height,margins:{...source.margins}}:{})};
    });
    const graph={...base,nodes,layers,phaseData:{diagnosticMask:mask,rankingSource:'upstream-observed-ranks'}};
    validateProperGraph(graph);
    return {mask,name:['layers','ports','geometry'].filter((_,bit)=>mask&(1<<bit)).join('+')||'canonical',graph:freezeRecord(graph)};
  });
}
