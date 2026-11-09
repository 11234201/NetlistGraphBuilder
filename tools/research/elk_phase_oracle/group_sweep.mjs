import {orderLayers} from '../../../src/layout/anchor_layered/p3_ordering.js';
import {createGroupSweepContext} from '../../../src/layout/anchor_layered/group_sweep.js';
export {createGroupSweepContext,cohereBandIds,cohereLayoutUnits} from '../../../src/layout/anchor_layered/group_sweep.js';
// Retain the research API, now using the explicit static sweep seam.
export async function compileGroupSweep(entries,{structuralKey=false,layoutUnits=false}={}){
  return (input,options)=>orderLayers(input,{...options,
    orderingDigest:structuralKey?input.orderingDigest:undefined,
    groupContext:createGroupSweepContext(input,entries),layoutUnits});
}
