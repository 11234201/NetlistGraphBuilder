import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Report every predeclared factor; never select a policy using these results.
const root=resolve(process.argv[2]??'dc_runs');
const modes=['baseline','groups','key','ports','key+ports','groups+key','groups+ports','all'];
const cases=['sop015_5426_focused_3_3','eq012_1471_focused_3_3','mapped_large_dp002'];
for(const mode of modes)for(const caseId of cases){
  const directory=resolve(root,`c01_factor_${mode}`);
  const report=JSON.parse(await readFile(resolve(directory,`${caseId}.report.json`),'utf8'));
  const native=report.reports.find(item=>item.provider==='native-layered');
  const elk=report.reports.find(item=>item.provider==='elk-layered');
  const graph=JSON.parse(await readFile(resolve(directory,`${caseId}.native-layered.graph.json`),'utf8'));
  const reset=graph.edges.find(edge=>edge.id==='edge:input:rst_n:cell:_842_:rst_n:1066:hub-out');
  console.log(JSON.stringify({mode,caseId,hard:native.validation.total,gates:report.gates,
    fragments:native.trees.fragmentedGroupCount,elkFragments:elk.trees.fragmentedGroupCount,
    length:native.quality.totalLength,elkLength:elk.quality.totalLength,
    crossings:native.quality.crossingCount,physicalCrossings:native.quality.physicalCrossingCount,
    uniqueLength:native.quality.uniqueWireLength,maxBends:native.quality.maxBends,
    resetRoute:reset?.route??reset?.points??null}));
}
