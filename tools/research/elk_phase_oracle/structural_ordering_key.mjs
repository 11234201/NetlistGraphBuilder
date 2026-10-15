export {structuralOrderingKey} from '../../../src/layout/elk_native/structural_ordering_key.js';
export function consumeStructuralKey(source){
  const before='randomStream(orderingDigest ?? input.inputDigest, input.options.randomSeed)';
  if(source.split(before).length!==2)throw Error('missing/ambiguous ordering-key consumer');
  source=source.replace(before,"randomStream(input.orderingDigest ?? (()=>{throw new PhaseError('research','missing-ordering-key');})(), input.options.randomSeed)");
  return source.replace('perturbationKey: `${orderingDigest ?? input.inputDigest}:${input.options.randomSeed}`',
    'perturbationKey: `${input.orderingDigest}:${input.options.randomSeed}`');
}
