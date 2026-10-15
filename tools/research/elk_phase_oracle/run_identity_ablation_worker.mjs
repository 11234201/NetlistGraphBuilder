import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createIdentityAblationResolver} from './identity_ablation_resolver.mjs';
import {instrumentSyncPhases} from './sync_phase_timings.mjs';

const args=process.argv.slice(2),legacyP2=args.includes('--legacy-p2'),legacyP5=args.includes('--legacy-p5');
const legacyTree=args.includes('--legacy-wire-tree');
const captureArguments=args.filter((arg)=>arg.startsWith('--capture-validation-dir=')||arg.startsWith('--capture-wire-routes-dir=')||arg.startsWith('--capture-ordering-dir='));
if(captureArguments.length>1)throw new Error('choose one capture boundary');
const captureArgument=captureArguments[0];
const captureBoundary=captureArgument?.startsWith('--capture-wire-routes-dir=')?'buildWireRoutes':
  captureArgument?.startsWith('--capture-ordering-dir=')?'orderLayers':'validateLayoutGraph';
const captureDirectory=captureArgument?.slice(captureArgument.indexOf('=')+1)??null;
if(captureArgument&&!captureDirectory)throw new Error('capture directory must be explicit');
const timings=args.includes('--timings')||Boolean(captureDirectory);
const worker=new URL('./cohesion_mapped_worker.mjs',import.meta.url);
process.argv=[process.argv[0],fileURLToPath(worker),...args.filter((arg)=>!['--legacy-p2','--legacy-p5','--legacy-wire-tree','--timings',captureArgument].includes(arg))];
process.env.MAPPED_CASE_PROVIDER=['c01-unit-anchor',legacyP2?'legacy-p2':'indexed-p2',
  legacyP5?'legacy-p5':'indexed-p5','ablation'].join('-');
console.error(`identity_ablation=${JSON.stringify({legacyP2,legacyP5,legacyTree,timings,captureDirectory,captureBoundary})}`);
const timingModules=new Set(['p1_orientation','p2_layering','proper_graph','p3_ordering','p4_placement','p5_routing',
  'validate_routes'].map((name)=>new URL(`../../../src/layout/elk_native/${name}.js`,import.meta.url).href));
timingModules.add(new URL('../../../src/layout/layoutValidator.js',import.meta.url).href);
for(const file of ['wireLabelPlacement','wireRoutes','nodeGeometry'])
  timingModules.add(new URL(`../../../src/layout/${file}.js`,import.meta.url).href);
registerHooks({resolve:createIdentityAblationResolver({legacyP2,legacyP5,legacyTree}),load:timings?(url,context,nextLoad)=>{
  const loaded=nextLoad(url,context);
  if(loaded.format!=='module'||loaded.source==null||!timingModules.has(url)&&!url.startsWith('data:text/javascript;base64,'))return loaded;
  const source=String(loaded.source),tag=createHash('sha256').update(source).digest('hex').slice(0,12);
  return {...loaded,source:instrumentSyncPhases(source,tag,{captureDirectory,captureBoundary})};
}:undefined});
await import(worker.href);
