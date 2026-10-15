# Native Layered provider implementation plan

Created: 2026-09-20. Updated: 2026-09-24. Status: in progress; NLD-01 through NLD-08 and
NLR-00 through NLR-10 are implemented. NLR-11 correctness passes, performance is paused by user direction,
and NLR-12 visual acceptance failed. Native Layered remains Experimental and Simple remains the default.
Development branch: `dev`.

This plan creates a new `native-layered` provider. It supersedes further attempts to turn the
existing Simple provider into ELK by incremental placement or routing flags. The existing Simple
provider remains unchanged and stays the product default until the replacement gates in this document
are complete.

## Objective

Reproduce the useful phase semantics of ELK layered in project-native, dependency-light JavaScript:

- proper adjacent-layer graph representation;
- bounded crossing minimization;
- recursive block alignment and balanced vertical compaction;
- slot-derived inter-layer boundary capacity;
- shared-segment orthogonal physical-net routing;
- deterministic results independent of parser/node/edge array order.

The implementation is behavioral, not a source-code port. Vendored ELK remains the visual and
quantitative golden. Native Layered may intentionally improve a result where ELK has a known defect, but every
deviation must be explained by topology and shared metrics rather than fixture identity.

## Non-goals and isolation rules

- Do not modify Simple placement, Simple routing, or its defaults while developing Native Layered.
- Do not insert Native Layered stages into `simpleLayered.js` behind feature flags.
- Do not copy ELK source into the production module or require a bundler/network dependency.
- Do not encode `eq012`, `_1471_`, instance names, net names, or absolute coordinates in algorithms.
- Do not mutate parser output, Netlist IR, automatic provider input, or the caller's graph arrays.
- Do not relax the shared orthogonal validator or acceptance budgets to admit a Native Layered result.
- Do not use group collapse as performance or correctness evidence.

Native Layered may reuse only shared boundaries: layout-provider contracts, node measurement, canonical net
keys, orthogonal geometry predicates, validators, spatial indexes, wire-route normalization, label
placement, renderer, workspace caching, cancellation and progress reporting.

## Acceptance scenarios

Primary golden scenarios:

1. `eq012`, Focused net `clk`, fanin/fanout depth 1/1.
2. `eq012`, Focused cell `_1471_`, fanin/fanout depth 3/3.
3. Full-node Whole mapped cases under `tests/fixtures/mapped/`.
4. Generated 1,024/4,096/8,192-cell performance fixtures.

Simple, vendored ELK and Native Layered must be rendered and measured from the same source graph and viewport.

## Target pipeline

```text
Source graph
  -> NLD-01 canonical graph model
  -> NLD-02 cycle breaking and layer assignment
  -> NLD-03 proper layering / dummy chains
  -> NLD-04 crossing minimization
  -> NLD-04A hyperedge dummy merging
  -> NLD-05 Brandes–Köpf block placement
  -> NLD-06 tree/shared structure and component packing
  -> NLD-07 port ordering and channel allocation
  -> NLD-08 orthogonal physical-net routing
  -> shared validation, labels and PositionedGraph normalization
```

## Work packages

| ID | Work | Exit gate | Status |
| --- | --- | --- | --- |
| NLD-00 | Freeze and baseline | Simple unchanged; durable metrics and handoff boundary | completed |
| NLD-01 | Canonical graph model | Stable internal identities and permutation tests | completed |
| NLD-02 | Cycle breaking and ranks | Reversible acyclic orientation and deterministic ranks | completed |
| NLD-03 | Proper layering | Every internal edge crosses one adjacent boundary | completed |
| NLD-04 | Crossing minimization | Bounded deterministic sweeps improve or retain the initial order | completed |
| NLD-04A | Hyperedge dummy merging | Adjacent same-net/source/target dummies merge once before placement | completed |
| NLD-05 | BK block placement | Recursive subtrees centre around parents without top packing | completed |
| NLD-06 | Tree/shared/component packing | Exclusive trees remain distinct; shared nodes appear once | completed; focused correctness passes |
| NLD-07 | Ports and channel capacity | Every routed demand owns bounded inter-layer capacity | superseded by NLR-01 through NLR-06 |
| NLD-08 | Physical-net routing | Zero missing/disconnected/hard violations on focused gates | superseded by NLR-07 through NLR-10 |
| NLD-09 | Whole/performance hardening | Mapped cases and benchmark budgets pass | correctness passes; performance acceptance paused |
| NLD-10 | Product acceptance | Same-viewport review and explicit default-provider decision | reviewed; visual gate failed, default unchanged |

### Progress checkpoint — 2026-09-20

`src/layout/native_layered/` owns a provider-private pipeline through an experimental first router. Both
focused scenarios reached zero missing routes and zero hard violations, and `_1471_` reached 6,336 x
31,492. The ordinary 649-test suite passed on `mfs-remote`. Full-node mapped evidence then disproved the
router design: `dp_002` left 128 logical edges unroutable and 24 physical routes disconnected, dominated
by high-fanout `clk` and `rst_n`. The old per-edge candidate/channel implementation is therefore retired as
an implementation base. NLD-07/08 continue through the NLR plan below; Simple remains unchanged and is
still the product default.

## NLD-00 — Freeze Simple and capture evidence

Completed on 2026-09-20. The implementation and metric baseline is recorded in
[`simple_layout_freeze_baseline.md`](simple_layout_freeze_baseline.md). Three-provider comparison becomes
active after Native Layered has a runnable provider shell; it is not a reason to modify the frozen Simple path.

- Remove uncommitted experiments that alter Simple.
- Add `native-layered` to the provider registry as Experimental only after it can return a valid
  empty/synthetic graph.
- Extend the comparison harness to run Simple, vendored ELK and Native Layered without changing input graphs.
- Record dimensions, area, missing routes, hard violations, logical/physical crossings, bends, unique
  wire length, outer routes, phase time and peak memory.
- Add a guard proving a Native Layered run does not change the Simple result or its normalized policy.

Exit gate: Simple golden output is byte/metric stable and no Native Layered module is imported by Simple.

## NLD-01 — Canonical internal graph

Create immutable provider-private records for layout nodes, ports, logical edges and physical nets.

- Stable keys derive from canonical object identity and topology, never source-array position.
- Canonical port order includes side, pin order and stable fallback keys.
- Logical edges retain their original source/target and physical-net owner.
- Internal objects can later carry `reversedForLayout`, rank, dummy-chain, alignment-block and channel
  metadata without changing public graph objects.
- Build indexes once at the phase boundary; do not introduce repeated all-graph scans in inner loops.

Tests: empty graph, disconnected graph, multi-edge physical net, feedback cycle, escaped names and
node/edge permutations.

## NLD-02 — Cycle breaking and rank assignment

- Use deterministic cycle breaking to build an acyclic layout orientation.
- Record every reversal and restore real source/target and pin meaning before output.
- Produce an initial longest-path rank assignment.
- Refine ranks with a bounded network-simplex-equivalent objective that reduces total edge span while
  respecting input/output boundary and minimum-length constraints.
- Focused roots are soft anchors; they are not assigned fixture coordinates or forced to a global row.

Exit gate: the oriented graph is acyclic, rank constraints hold, restoration is exact, and permutations
produce identical ranks.

## NLD-03 — Proper layering

- Split every edge spanning more than one rank into a provider-private dummy chain.
- Give each dummy a stable key based on physical net, oriented endpoints and crossed boundary.
- Keep one logical-edge ownership record so chains can be joined without exposing dummy nodes to UI.
- Count physical-net demand once per crossed boundary; fanout branches must not multiply shared demand.

Exit gate: every internal segment connects adjacent ranks and join-back reconstructs every logical edge.

## NLD-04 — Crossing minimization

- Build an initial stable order per rank.
- Run alternating forward/backward median or barycenter sweeps.
- Apply bounded adjacent transpose passes only when the crossing objective improves.
- Honor port order, fixed boundary order, dummy-chain continuity and explicit ordering constraints.
- Count adjacent-layer crossings using an indexed inversion count, not all edge pairs.
- Retain the best candidate over a fixed policy limit; runtime attempts must not grow with graph size.

Exit gate: no candidate is worse than the initial order, the iteration bound is reported, and the result
is invariant under graph-array permutation.

## NLD-04A — Hyperedge dummy merging

ELK schedules this work between ordering and placement: `HyperedgeDummyMerger` is registered before P4 and
is active as soon as any port has more than one incident edge, so every high-fanout netlist triggers it.
The research note records this as one reason high-fanout wiring becomes shared structure. Native Layered
must make the same decision explicitly instead of leaving it implicit.

- Run after NLD-04 and before NLD-05, on the same proper-layer graph.
- Merge adjacent long-edge dummies that share the same canonical physical net, the same real source, or the
  same real target.
- Keep one ownership record per merged dummy so NLD-03 join-back still reconstructs every logical edge; a
  merge must never drop a branch.
- Never merge across different drivers. Canonical physical-net identity stays stricter than ELK port
  connectivity.
- Report dummy counts before and after merging in layout metrics.

Exit gate: on `_1471_` the `clk` and `rst_n` dummy chains collapse to one chain per crossed boundary before
placement, and logical-edge reconstruction still passes. If merging is deferred instead, the decision and
its substitute mechanism are recorded here before NLD-05 is accepted; silence is not an option because
NLR-12 requires one shared control trunk per occupied boundary.

## NLD-05 — Brandes–Köpf block placement

Implement conflict marking, vertical alignment and compaction for four candidates:

- downward-left;
- downward-right;
- upward-left;
- upward-right.

Each candidate forms alignment blocks from median predecessor/successor relationships. A block is the
atomic placement object: compaction moves blocks, never individual nodes inside an established block.
Normalize the four candidates to a common origin and combine them using median/balanced coordinates.

This stage owns the central acceptance problem: an internal parent must lie near the centre of its direct
child span; a short subtree must be centred relative to a taller peer; no later pass may repack descendants
from the top of a layer.

Exit gate: recursive synthetic trees at depths 2-5 remain centred at every depth and do not top-pack.

## NLD-06 — Tree, shared-DAG and component packing

- Derive immediate focused branches from topology.
- Propagate exclusive/shared membership through the visible DAG.
- Pack exclusive trees as separate blocks.
- Represent shared structure once in a shared block between its participating owners.
- Preserve shared-node identity; never duplicate it into an arbitrary tree.
- Layout disconnected components independently, then pack component boxes with deterministic spacing.
- Component/tree separation accounts for reserved channel demand, not a fixture-tuned constant gap.

Exit gate on `_1471_`: four input branches are visually distinct, exclusive membership is contiguous in
every visual column, the two shared regions appear once, and second/third-level subtrees remain centred.

The recursive grouping gate also includes `sop_015`, Focused on `_5426_` at depth 3/3. The two exclusive
fanin frontiers beneath `_5404_` must keep at least 96 px of vertical separation while shared nodes retain
one identity. This is measured from positioned geometry, not inferred from instance names during layout.

## NLD-07 — Port order and channel capacity

- Resolve port order before final routing.
- Build per-boundary physical-net intervals from proper-layer dummy chains.
- Allocate lanes with deterministic interval colouring.
- Assign corridor ownership to exclusive tree, shared block, component or global control structure.
- Reserve source/target escape capacity separately from long inter-layer capacity.
- If demand exceeds capacity, expand the owning inter-layer gap and rerun coordinate projection once.
- Never use a graph-size-proportional retry loop or an unrestricted outer-lane search.

Exit gate: every demand has a capacity assignment or a stable overflow diagnostic before route geometry is
generated.

## NLD-08 — Orthogonal physical-net routing

Native Layered routing is provider-private automatic routing; it does not call the Simple router.

- Prefer source-horizontal, channel-vertical and target-horizontal geometry.
- Route a physical net atomically with shared trunks and explicit junctions.
- Keep route orientation consistent inside a tree/corridor.
- Generate a fixed small set of geometry variants from allocated lanes.
- Validate each variant using shared orthogonal/node/overlap predicates.
- If all variants fail, report a deterministic unroutable physical net; never partially publish the net.
- Join dummy chains and restore original logical edge direction and pins.

Exit gate: both focused scenarios have zero missing routes, zero disconnected wire routes and zero hard
validation violations.

## Native ELK-style routing replacement (NLR)

Decision date: 2026-09-21. This section replaces the implementation approach of NLD-07 and NLD-08. It is
based on the pinned-source findings in
[`elk-layered-layout-routing.md`](../research/elk-layered-layout-routing.md), especially ELK's
`OrthogonalRoutingGenerator`, `HyperEdgeSegmentSplitter`, `WestToEastRoutingStrategy`,
`HyperedgeDummyMerger` and `LongEdgeJoiner`.

### Replacement rule

Native Layered will not reuse its experimental candidate router:

- `channel_allocation.js` and `physical_net_routing.js` are temporary evidence only;
- the new router must not import those modules, Simple/Adjust route candidate generators, outer-lane
  search, or their route-scoring policies;
- the new runtime path must not fall back to the old router when a segment cannot be assigned;
- after the replacement vertical slice passes, the provider switches once and the old Native files and
  their implementation-specific tests are removed;
- shared geometry predicates, spatial indexes, graph normalization, labels, validators and wire-route
  construction remain valid boundaries and are not considered the old routing implementation.

A static architecture test will enforce these import restrictions. Keeping the old code behind a hidden
flag does not satisfy completion.

### Target routing pipeline

```text
Proper layered graph + final y/port order
  -> NLR boundary routing graph
  -> connected physical-net hyperedge segments
  -> indexed critical/weighted ordering constraints
  -> deterministic dependency-cycle resolution and segment splitting
  -> topological slot numbering
  -> boundary-width computation and final x projection
  -> shared-trunk/tap geometry with junctions
  -> long-edge join-back and semantic direction restoration
  -> atomic physical-net commit
  -> shared validation, labels and PositionedGraph normalization
```

The phase split is deliberate. Segment ordering depends on final y/port coordinates but not final x.
Slot count determines the width of each inter-layer boundary; only after every boundary has a slot plan are
layer x positions projected and bend points materialized.

### Proposed module boundary

Production modules live under `src/layout/native_layered/router/` and use the repository's C++-independent
JavaScript filename convention:

| Module | Ownership |
| --- | --- |
| `routing_graph.js` | Immutable boundary, port, tap and physical-net records; stable indexes |
| `hyperedge_segments.js` | Connected-component construction and same-net shared segment identity |
| `segment_conflicts.js` | Exact small-oracle predicates plus indexed production conflict discovery |
| `segment_dependencies.js` | Critical and weighted ordering constraints with stable keys |
| `segment_cycle_breaking.js` | SCC detection, deterministic dependency reversal/removal and split decisions |
| `segment_splitting.js` | Free-y-interval selection and two-trunk bridge records |
| `slot_assignment.js` | Stable topological numbering and rightward-only compaction |
| `boundary_projection.js` | Slot-count width and final rank x projection |
| `route_geometry.js` | H-V-H taps, split bridges and explicit junction points |
| `long_edge_joining.js` | Dummy-chain concatenation and layout-direction restoration |
| `net_commit_gate.js` | Complete-net validation and all-or-nothing publication through the shared `physical_net_commit.js` validator |
| `native_orthogonal_router.js` | Phase orchestration, cancellation points, metrics and diagnostics |

Names may be refined during implementation, but ownership must not collapse back into a monolithic
candidate loop.

### Internal records

The router-private model is immutable at phase boundaries:

```text
BoundaryRoutingGraph
  boundaryKey, leftRank, rightRank
  sourcePorts[], targetPorts[]
  segmentInputs[]

HyperedgeSegment
  segmentKey
  physicalNetKey
  boundaryKey
  incomingY[]
  outgoingY[]
  logicalEdgeKeys[]
  minimumY, maximumY
  straight
  splitPartnerKey?

SegmentDependency
  sourceSegmentKey, targetSegmentKey
  critical
  weight
  reason                 # endpoint-overlap | near-conflict | crossing-preference | split-order

BoundarySlotPlan
  segmentSlots
  slotCount
  splitCount
  dependencyCount
  criticalDependencyCount
  routingWidth
```

Physical identity uses the canonical driver/net grouping already established in NLD-01. Connectivity may
merge branches of that physical net, but label equality alone never merges nets.

### Complexity contract

- Build boundary/segment indexes in `O(V + E)` over the proper graph.
- Sort tap coordinates once per boundary in `O(D log D)`.
- Discover critical near-coordinate conflicts through coordinate buckets and interval queries. Do not run
  an unconditional segment-pair nested loop.
- Discover soft crossing preferences with a sweep that visits only active interval neighbours selected by
  a named bound. Record truncation as a diagnostic; do not grow attempts with graph size.
- Run one deterministic SCC pass on the dependency graph.
- Split at most one selected segment per critical SCC in one split phase, then rebuild only dependencies
  incident to created split partners. There is no retry-until-success loop.
- Topological slot assignment and geometry materialization are `O(S + C + E)`, where `S` is segment count
  and `C` is emitted dependencies.
- Final validation may use shared indexes but must not be used as a search oracle for dozens of variants.

Generated 1,024/4,096/8,192-cell evidence must report `S`, `C`, maximum active candidates, split count,
slot count, phase time and peak memory so a hidden dense cliff is visible.

### Work packages

| ID | Work | Implementation result | Exit gate | Status |
| --- | --- | --- | --- | --- |
| NLR-00 | Freeze and quarantine | Capture current focused/mapped/performance evidence; mark old Native routing modules non-authoritative; freeze Simple output | Baseline commands and metrics are durable; no new changes enter old router | completed |
| NLR-01 | Boundary routing IR | Build immutable adjacent-boundary ports/taps/net records from proper layering | Every segment input belongs to one boundary and physical net; permutations are identical | implemented; focused gates pass |
| NLR-02 | Hyperedge segment construction | Traverse connected same-net boundary ports and form one shared trunk record per component | Synthetic fanout produces one trunk with all taps; different drivers never merge | implemented; focused gates pass |
| NLR-03 | Exact conflict oracle | Implement small-boundary ELK-semantic conflict/crossing predicates for tests only | Hand cases cover straight, nested, crossing, near-conflict and critical-conflict order | implemented; focused gates pass |
| NLR-04 | Indexed dependency builder | Replace ELK's all-pairs loop with coordinate buckets and bounded interval sweep | Matches NLR-03 on bounded exhaustive cases; reports candidate/dependency bounds | implemented; whole-graph hardening open |
| NLR-05 | Cycle handling and splitting | Deterministic SCC handling, critical segment split and free-y bridge selection | Critical cycles become acyclic in one pass; no random choice or fixture identity | implemented; whole-graph hardening open |
| NLR-06 | Slot assignment and x projection | Number slots, compact rightward-only segments, derive boundary widths, then project rank x | Straight segments use no slot; node/channel spacing holds without pre-expansion | implemented; whole-graph hardening open |
| NLR-07 | Geometry and junctions | Materialize shared vertical trunks, horizontal taps and split bridges | Geometry is orthogonal, exact-port attached and structurally outside node columns | implemented; focused gates pass |
| NLR-08 | Join-back and atomic nets | Join boundary pieces through dummy chains, restore direction/pins and commit complete physical nets | No physical net can be partially published; missing pieces produce one stable net diagnostic | implemented; focused gates pass |
| NLR-09 | Exceptional port directions | Add reversed layout edges, self-loops and north/south port adapters as explicit subpipelines | Each class has focused tests; west/east core contains no hidden special case | implemented; focused gates pass |
| NLR-10 | Provider cutover and removal | Integrate `native_orthogonal_router.js`, remove old Native channel/candidate modules and forbid imports | Native runs only the new router; Simple bytes/metrics remain unchanged | completed | 2026-09-22 |
| NLR-11 | Whole/performance hardening | Run unit, determinism, full-node mapped, mapped benchmark and 1K/4K/8K benchmarks on `mfs-remote` | Required suites finish within budgets; no missing/disconnected/hard violations accepted by hidden fallback | correctness pass; performance paused |
| NLR-12 | Product/visual acceptance | Same-source/same-viewport Simple, ELK and Native review; update NLD-09/10 decision | Focused visual gates pass, mapped/performance evidence is recorded, default decision is explicit | reviewed; visual gate failed, remains open |

### Detailed gates by package

#### NLR-00 — freeze before replacement

- Record the last reliable focused results and the full-node failure that triggered redesign.
- Stop modifying the old candidate list. Any already-started experiment remains uncommitted evidence and
  is either discarded or removed at NLR-10.
- Add a Simple golden guard around the comparison scenarios and normalized layout policy.

Stop condition: if source graphs or acceptance queries differ between providers, repair the harness before
router development.

#### NLR-01/02 — reproduce the routed object model

- Use proper-layer segment ownership, not public edge array position.
- Consume the merged proper graph produced by NLD-04A. The router merges taps inside a boundary; it does not
  re-decide placement-level dummy identity.
- Build port connectivity over one boundary only; a long edge appears in consecutive boundary graphs and
  is joined later.
- Treat one physical net as the publication unit across all boundaries.
- Preserve incoming and outgoing tap lists separately and keep them sorted by y then stable port key.
- Mark exactly aligned source/target coordinate sets as straight and slot-free.
- Do not expose dummies, trunks or split partners to UI graph nodes.

Tests include empty boundary, direct edge, 512-load fanout, reconvergent same-net taps, two drivers sharing
a label, escaped/hierarchical identifiers, disconnected components and array permutations.

#### NLR-03/04 — ordering without ELK's quadratic cliff

The exact oracle mirrors ELK's conflict semantics only in unit tests and is capped to small segment sets.
Thresholds are named policy values, not literals inside predicates, and two of them are per-boundary:

- straight tolerance: an absolute epsilon under which a segment extent counts as zero;
- conflict threshold: `0.5 * edgeEdgeSpacing`;
- critical conflict threshold: `0.2 * minimumAdjacentTapDistance`, where that distance is the smallest gap
  between two adjacent coordinates in the boundary's sorted incoming tap set and in its sorted outgoing tap
  set;
- dependency weights: conflict and crossing penalties in ELK's ratio, with crossing materially larger.

Critical constraints always win. Soft dependency direction minimizes weighted conflicts/crossings using the
weights above, and equal non-zero costs create a deterministic zero-weight two-cycle for NLR-05 to resolve.
NLR-03 must reproduce the dynamic critical threshold; otherwise the oracle comparison in NLR-04 fails for
reasons that have nothing to do with the indexed builder.

Production uses:

1. sorted incoming/outgoing tap arrays;
2. coordinate buckets for critical-distance collisions;
3. an interval sweep for overlapping trunk extents;
4. bounded active-neighbour selection for soft crossing preferences;
5. stable dependency deduplication keyed by ordered segment pair and reason.

Exit evidence includes exhaustive small integer-coordinate comparison against the oracle, permutation
tests, and a dense synthetic case proving the configured dependency/candidate cap is reported rather than
silently exceeded.

#### NLR-05 — deterministic cycle resolution

- Detect SCCs iteratively to avoid recursion depth limits.
- Run the critical-cycle pass only when the boundary emitted at least two critical dependencies; a boundary
  with fewer cannot contain a critical cycle. Non-critical cycle breaking still runs for every boundary.
- For non-critical SCCs, remove zero-weight symmetric dependencies first, then reverse the minimum-weight
  dependency using stable topology keys.
- For a critical SCC, prefer splitting a non-hyperedge segment; otherwise choose the shortest segment,
  then the stable segment key.
- Find free y intervals from sorted tap coordinates. Choose the interval with the fewest new crossings,
  then fewest new dependencies, then nearest centre, then stable coordinate order.
- Emit two linked segment records and mandatory `left -> blocker -> right` critical dependencies.

The phase executes once. Remaining critical cycles are a deterministic hard diagnostic, not permission to
retry, use an outer lane or call the old router.

#### NLR-06/07 — slots own x and geometry

- Topologically number non-straight segments; straight segments retain no slot.
- Push segments with only rightward taps toward the rightmost legal slot, matching ELK's compactness rule.
- Compute boundary width from slot count, edge-edge spacing and source/target escape spacing; use the named
  node-node minimum where both sides are real layers.
- Project node x coordinates only after every boundary width is known.
- Materialize unsplit segments as horizontal source tap, shared vertical trunk, horizontal target tap.
- Materialize a split as two trunks joined by one horizontal bridge at the chosen free y coordinate.
- Derive junctions from trunk interior/shared-endpoint taps and deduplicate them by physical-net identity.

No geometry candidate list exists in these phases. Failure means an upstream constraint or split-plan
diagnostic.

#### NLR-08/09 — semantic restoration and exceptional cases

- Concatenate boundary geometry in logical chain order and remove redundant collinear points.
- Restore original source/target and pin semantics after cycle-breaking reversals.
- Validate and publish all logical branches of a physical net together. On failure publish none of that
  net and attach one net-level diagnostic plus affected edge IDs. Use the shared `validatePhysicalNetCommit`
  boundary; do not fork a private copy of it.
- Build shared `wireRoutes` from the committed geometry, then run shared label placement.
- Route self-loops and north/south ports through named bounded adapters; do not contaminate the main
  west-to-east segment algorithm.

#### NLR-10 — irreversible cutover inside the Experimental provider

- Keep the new modules directly unit-testable until NLR-01 through NLR-09 pass.
- Switch `NativeLayeredLayoutProvider` from the old channel/router pair to the new orchestrator in one
  reviewable change.
- Delete `channel_allocation.js`, `physical_net_routing.js` and tests that assert their private behavior.
- Add an architecture test over `src/layout/native_layered/router/` that rejects the deleted path
  (`channel_allocation.js`, `physical_net_routing.js`) and these Simple/Adjust routing modules:
  `simpleRouteCandidates.js`, `localRouteCandidates.js`, `routeLaneCandidates.js`, `routeScoring.js`,
  `routeSearchPolicy.js`, `channelCapacity.js`, `simpleOrthogonalRouter.js`, `localOrthogonalRouter.js`.
- The same test must keep the shared boundaries importable, because geometry and validation depend on them:
  `routeCandidateValidation.js`, `orthogonalRouting.js`, `spatialIndex.js`, `physical_net_commit.js`,
  `wireRoutes.js`, `wireLabelPlacement.js`, `nodeGeometry.js` and `layoutTopology.js`. Encode both lists
  explicitly so the test neither over-blocks validators NLR-07/08 need nor under-blocks the retired search
  policy.
- Do not change the default provider; Native remains explicitly Experimental through NLR-12.

#### NLR-11/12 — acceptance matrix

Machine gates:

```text
npm test
MAPPED_CASE_PROVIDER=native-layered MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases
MAPPED_BENCHMARK_PROVIDER=native-layered npm run benchmark:mapped
BENCHMARK_PROVIDER=native-layered BENCHMARK_SIZES=1024,4096,8192 npm run benchmark
```

Additional assertions:

- both eq012 focused gates: zero missing, disconnected and hard violations;
- `_1471_`: width <= 6,600 and area not materially above the same-run ELK result;
- `clk`: one visible shared control trunk per occupied boundary and consistent horizontal DFF entry;
- full mapped cases: every edge routed and every physical wire tree connected; hard validation stays on;
- repeated runs and node/edge permutations produce identical node positions, slots, splits and routes;
- `dependencyCount`, `maximumActiveCandidates`, `splitCount`, `slotCount` and every routing phase time are
  present in metrics;
- 1K/4K/8K growth is bounded and contains no candidate-count or dependency-count cliff;
- same-viewport browser review compares Simple, vendored ELK and Native from the same source graph.

If the indexed dependency builder cannot reproduce the small oracle, or if the 8K case needs an
unbounded conflict set, stop and revise NLR-04. If machine gates pass but shared trunks/branches remain
visually incoherent, NLR-12 remains open. Native does not become the default automatically.

## NLD-09 — Whole and performance hardening

- Run ordinary unit, determinism and fixture invariant suites.
- Run `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases`.
- Run `npm run benchmark` and mapped benchmarks on `mfs-remote`.
- Track phase time, candidate counts, allocated lanes, overflow, route variants and peak memory.
- Crossing reduction should remain near `O(E log V)` per bounded sweep; placement near `O(V + E)`;
  routing must use spatial/interval indexes.

Performance target: Focused may initially take up to about twice vendored ELK time, but must have bounded
growth. Whole performance must move toward ELK without edge-count cliffs or quadratic candidate growth.

## NLD-10 — Product acceptance and replacement

### `clk`, depth 1/1

- Source travels horizontally into a shared trunk before vertical branching.
- Branches enter DFFs horizontally and use a consistent orientation.
- Zero missing routes and hard violations.
- No large family of outer routes.
- DFF banks are orderly and visually balanced.

### `_1471_`, depth 3/3

- Zero missing routes, hard violations and disconnected physical nets.
- Width no greater than 6,600; area must not materially exceed vendored ELK.
- Four input trees are distinguishable at first glance.
- Subtrees at every visible depth are centred rather than packed against the top.
- Exclusive memberships remain contiguous; shared nodes are rendered once in explicit shared regions.
- Tree routing direction is consistent and channel ownership is visible.

### Stability and replacement rule

- Node and edge permutations produce identical positions and routes.
- Repeated runs are identical.
- Simple output is unchanged.
- Same-viewport browser review passes for Simple, vendored ELK and Native Layered.

Passing Focused gates permits exposing Native Layered as a user-selectable Experimental provider. Passing Whole,
mapped-case, benchmark and browser gates permits a separate decision about making it the default. Simple
remains a fallback until an explicit removal task is approved; implementation completion alone never
replaces the default.

## Verification commands

```text
npm test
npm run test:mapped-cases
MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases
npm run benchmark
```

Heavy mapped and performance runs use the `mfs-remote` Linux workspace. Comparison artifacts, synthesis
logs and scratch reports remain untracked; only durable fixtures, harnesses and plan/architecture changes
are committed.
