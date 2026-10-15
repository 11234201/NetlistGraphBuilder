# Offline H08 layout package

Package `0.3.0`, base IR contract `1.1.0`, fixed H08 semantic profile `1.0.0`.
The profile is explicit and versioned; the baseline phase-oracle behavior remains available in `index.js`.
No package installation, bundler, source rewriting, native helper, network or ELK runtime is required.

```js
import {layoutGraph} from './src/layout/elk_native/h08.js';

const abortController = new AbortController();
const result = await layoutGraph({
  nodes: [
    {id:'a', width:40, height:30, ports:[{id:'a:o', side:'EAST', x:40, y:15}]},
    {id:'b', width:40, height:30, ports:[{id:'b:i', side:'WEST', x:0, y:15}]}
  ],
  edges: [{id:'ab', physicalNetId:'signal', sourcePortId:'a:o', targetPortId:'b:i'}]
}, {signal: abortController.signal});
```

The caller owns measurement and public DTO conversion. Use the application adapter for schematic graph
measurement, physical wire construction, labels and renderer/workspace conversion. Inputs are not mutated;
only complete validated immutable geometry is returned. Diagnostics reject unsupported input rather than
silently returning a partial drawing or invoking a fallback engine.

Optional `orderGroups` consists of `{nodeId, membershipKey}` records derived from public topology.
The entry snapshots, validates and canonically sorts them before any asynchronous observation. It records
a separate profile/hint digest while retaining the full canonical `inputDigest` and the exact structural
ordering digest. Labels do not become ordering keys; changed measurements can legitimately change layout.

H08 fixes implicit per-edge endpoint identities, the original three P3 candidates plus one unit sweep,
unchanged crossing/constraint bounds and exact same-net/node/side/anchor P5 adjacency. The group-band
forecast currently rejects grouped self-loop graphs and merged rank columns; it does not silently broaden
tolerance or add a repair pass. Ungrouped self-loop handling follows the base pipeline.

`onPhase` observes immutable raw boundaries for tests. `yieldControl` allows a host to schedule between
checkpoints. Cancellation is checked at checkpoints and bounded searches; synchronous phase work does not
promise immediate browser-thread preemption. The application must also isolate obsolete job results.

Acceptance status, exact frozen runs, known timeouts and user visual decisions are tracked in
`docs/plans/h08_acceptance_checklist.md`. Importability is not a claim of universal ELK parity or release approval.
