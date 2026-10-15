# ELK-native layered package

Contract 1.1.0; package version 0.3.0, H08 profile 1.0.0. Browser-native ES modules, no bundler or install step.
The existing Experimental provider explicitly selects H08; Simple remains the default.

Implemented: immutable canonical P0, weighted greedy P1, tight-tree Network Simplex P2, proper long-edge and
inverted-port graphs, fixed-port dual-distributor P3, hyperedge dummy merging, four complete BK P4 candidates,
and boundary-hyperedge orthogonal P5. P5 includes indexed exact dependencies, critical splitting, weighted
feedback decisions, topological slots, layer-x projection, bends/junctions and logical-edge restoration.
Fixed west/east self-loops reserve margins before P4. Only whole disconnected components are packed afterward.
Every phase supports cancellation. The registered adapter uses the same static implementation, not research compilation.

Direct offline use (no npm install or build):

```js
import { layoutGraph } from './src/layout/elk_native/h08.js';
const controller = new AbortController();
const positioned = await layoutGraph({
  nodes: [{ id: 'a', width: 60, height: 40, ports: [] }],
  edges: []
}, { signal: controller.signal });
```

Ports have canonical `id`, `side`, relative `x/y` and optional `anchor`, dimensions and `borderOffset`.
Edges have `id`, `physicalNetId`, `sourcePortId` and `targetPortId`. Inputs are snapshotted and never mutated.
Only complete validated geometry is returned; failures reject with a phase diagnostic, without another router.
The raw `index.js` baseline profile is retained for controlled phase tests, not as a second UI provider.
See `docs/design/elk_h08_package.md` for H08 order-group inputs, limits and profile metadata.

Behavioral research source: Eclipse ELK commit `28e5173243cab0cf4e2c9816c803bc0d5c47ab24`, EPL-2.0,
`p1cycles/GreedyCycleBreaker`, `p2layers/NetworkSimplexLayerer`, `alg.common/networksimplex/NetworkSimplex`.
Proper/order behavior is grounded in `LongEdgeSplitter`, `InvertedPortProcessor`, `HyperedgeDummyMerger`,
`LayerSweepCrossingMinimizer`, both port distributors, `BarycenterHeuristic`, `ForsterConstraintResolver` and
the crossing counters. DSU/Fenwick formulations and topology-seeded attempts are independently structured.
Production modules are independently structured behavioral implementations; no upstream source translation or old
Native algorithm import is used. The executable pinned upstream harness is separate research infrastructure.

Documented adaptations: canonical ID ties replace seeded/allocation ordering; weighted equality protects balancing
optimality for unequal priorities; iteration exhaustion retains feasible ranks with explicit nonoptimal diagnostics,
matching ELK's bounded loop. It never publishes incomplete or hard-invalid geometry. Clockwise fixed ports and
source geometry are preserved in the canonical adapter. See `docs/design/elk-native-phase-contracts.md` and
`docs/plans/elk-native-reimplementation-plan.md` for the complete phase and acceptance contract.

Run all package tests with `node --test tests/unit/elk_native*.test.js`.
`tools/research/elk_phase_oracle/compare_native_phases.mjs` reports the first divergent decision on saved upstream
snapshots. Raw phase observation is test-only and never publishes partial provider geometry.
