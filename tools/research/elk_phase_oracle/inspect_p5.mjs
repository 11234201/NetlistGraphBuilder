import { loadPhaseOracles } from '../../../tests/helpers/elk_phase_inputs.js';
for(const oracle of await loadPhaseOracles()){
  const snapshot=oracle.snapshots.find((entry)=>entry.boundary==='p5');
  console.log(JSON.stringify({id:oracle.fixture.caseId,events:snapshot.phaseData.events.slice(0,3),
    nodes:snapshot.components.flatMap((entry)=>entry.nodes).length,
    edges:snapshot.components.flatMap((entry)=>entry.edges).slice(0,8)},null,2));
}
