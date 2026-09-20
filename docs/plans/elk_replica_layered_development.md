# ELK Replica layered provider implementation plan

Date: 2026-09-20. Status: in progress; ERL-00 complete. Development branch: `dev`.

This plan creates a new `elk-replica-layered` provider. It supersedes further attempts to turn the
existing Simple provider into ELK by incremental placement or routing flags. The existing Simple
provider remains unchanged and stays the product default until the replacement gates in this document
are complete.

## Objective

Reproduce the useful phase semantics of ELK layered in project-native, dependency-light JavaScript:

- proper adjacent-layer graph representation;
- bounded crossing minimization;
- recursive block alignment and balanced vertical compaction;
- explicit inter-layer channel capacity;
- consistent orthogonal physical-net routing;
- deterministic results independent of parser/node/edge array order.

The implementation is behavioral, not a source-code port. Vendored ELK remains the visual and
quantitative golden. Replica may intentionally improve a result where ELK has a known defect, but every
deviation must be explained by topology and shared metrics rather than fixture identity.

## Non-goals and isolation rules

- Do not modify Simple placement, Simple routing, or its defaults while developing Replica.
- Do not insert Replica stages into `simpleLayered.js` behind feature flags.
- Do not copy ELK source into the production module or require a bundler/network dependency.
- Do not encode `eq012`, `_1471_`, instance names, net names, or absolute coordinates in algorithms.
- Do not mutate parser output, Netlist IR, automatic provider input, or the caller's graph arrays.
- Do not relax the shared orthogonal validator or acceptance budgets to admit a Replica result.
- Do not use group collapse as performance or correctness evidence.

Replica may reuse only shared boundaries: layout-provider contracts, node measurement, canonical net
keys, orthogonal geometry predicates, validators, spatial indexes, wire-route normalization, label
placement, renderer, workspace caching, cancellation and progress reporting.

## Acceptance scenarios

Primary golden scenarios:

1. `eq012`, Focused net `clk`, fanin/fanout depth 1/1.
2. `eq012`, Focused cell `_1471_`, fanin/fanout depth 3/3.
3. Full-node Whole mapped cases under `tests/fixtures/mapped/`.
4. Generated 1,024/4,096/8,192-cell performance fixtures.

Simple, vendored ELK and Replica must be rendered and measured from the same source graph and viewport.

## Target pipeline

```text
Source graph
  -> ERL-01 canonical graph model
  -> ERL-02 cycle breaking and layer assignment
  -> ERL-03 proper layering / dummy chains
  -> ERL-04 crossing minimization
  -> ERL-05 Brandes–Köpf block placement
  -> ERL-06 tree/shared structure and component packing
  -> ERL-07 port ordering and channel allocation
  -> ERL-08 orthogonal physical-net routing
  -> shared validation, labels and PositionedGraph normalization
```

## Work packages

| ID | Work | Exit gate | Status |
| --- | --- | --- | --- |
| ERL-00 | Freeze and baseline | Simple unchanged; durable metrics and handoff boundary | completed |
| ERL-01 | Canonical graph model | Stable internal identities and permutation tests | pending |
| ERL-02 | Cycle breaking and ranks | Reversible acyclic orientation and deterministic ranks | pending |
| ERL-03 | Proper layering | Every internal edge crosses one adjacent boundary | pending |
| ERL-04 | Crossing minimization | Bounded deterministic sweeps improve or retain the initial order | pending |
| ERL-05 | BK block placement | Recursive subtrees centre around parents without top packing | pending |
| ERL-06 | Tree/shared/component packing | Exclusive trees remain distinct; shared nodes appear once | pending |
| ERL-07 | Ports and channel capacity | Every routed demand owns bounded inter-layer capacity | pending |
| ERL-08 | Physical-net routing | Zero missing/disconnected/hard violations on focused gates | pending |
| ERL-09 | Whole/performance hardening | Mapped cases and benchmark budgets pass | pending |
| ERL-10 | Product acceptance | Same-viewport review and explicit default-provider decision | pending |

## ERL-00 — Freeze Simple and capture evidence

Completed on 2026-09-20. The implementation and metric baseline is recorded in
[`simple_layout_freeze_baseline.md`](simple_layout_freeze_baseline.md). Three-provider comparison becomes
active after Replica has a runnable provider shell; it is not a reason to modify the frozen Simple path.

- Remove uncommitted experiments that alter Simple.
- Add `elk-replica-layered` to the provider registry as Experimental only after it can return a valid
  empty/synthetic graph.
- Extend the comparison harness to run Simple, vendored ELK and Replica without changing input graphs.
- Record dimensions, area, missing routes, hard violations, logical/physical crossings, bends, unique
  wire length, outer routes, phase time and peak memory.
- Add a guard proving a Replica run does not change the Simple result or its normalized policy.

Exit gate: Simple golden output is byte/metric stable and no Replica module is imported by Simple.

## ERL-01 — Canonical internal graph

Create immutable provider-private records for layout nodes, ports, logical edges and physical nets.

- Stable keys derive from canonical object identity and topology, never source-array position.
- Canonical port order includes side, pin order and stable fallback keys.
- Logical edges retain their original source/target and physical-net owner.
- Internal objects can later carry `reversedForLayout`, rank, dummy-chain, alignment-block and channel
  metadata without changing public graph objects.
- Build indexes once at the phase boundary; do not introduce repeated all-graph scans in inner loops.

Tests: empty graph, disconnected graph, multi-edge physical net, feedback cycle, escaped names and
node/edge permutations.

## ERL-02 — Cycle breaking and rank assignment

- Use deterministic cycle breaking to build an acyclic layout orientation.
- Record every reversal and restore real source/target and pin meaning before output.
- Produce an initial longest-path rank assignment.
- Refine ranks with a bounded network-simplex-equivalent objective that reduces total edge span while
  respecting input/output boundary and minimum-length constraints.
- Focused roots are soft anchors; they are not assigned fixture coordinates or forced to a global row.

Exit gate: the oriented graph is acyclic, rank constraints hold, restoration is exact, and permutations
produce identical ranks.

## ERL-03 — Proper layering

- Split every edge spanning more than one rank into a provider-private dummy chain.
- Give each dummy a stable key based on physical net, oriented endpoints and crossed boundary.
- Keep one logical-edge ownership record so chains can be joined without exposing dummy nodes to UI.
- Count physical-net demand once per crossed boundary; fanout branches must not multiply shared demand.

Exit gate: every internal segment connects adjacent ranks and join-back reconstructs every logical edge.

## ERL-04 — Crossing minimization

- Build an initial stable order per rank.
- Run alternating forward/backward median or barycenter sweeps.
- Apply bounded adjacent transpose passes only when the crossing objective improves.
- Honor port order, fixed boundary order, dummy-chain continuity and explicit ordering constraints.
- Count adjacent-layer crossings using an indexed inversion count, not all edge pairs.
- Retain the best candidate over a fixed policy limit; runtime attempts must not grow with graph size.

Exit gate: no candidate is worse than the initial order, the iteration bound is reported, and the result
is invariant under graph-array permutation.

## ERL-05 — Brandes–Köpf block placement

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

## ERL-06 — Tree, shared-DAG and component packing

- Derive immediate focused branches from topology.
- Propagate exclusive/shared membership through the visible DAG.
- Pack exclusive trees as separate blocks.
- Represent shared structure once in a shared block between its participating owners.
- Preserve shared-node identity; never duplicate it into an arbitrary tree.
- Layout disconnected components independently, then pack component boxes with deterministic spacing.
- Component/tree separation accounts for reserved channel demand, not a fixture-tuned constant gap.

Exit gate on `_1471_`: four input branches are visually distinct, exclusive membership is contiguous in
every visual column, the two shared regions appear once, and second/third-level subtrees remain centred.

## ERL-07 — Port order and channel capacity

- Resolve port order before final routing.
- Build per-boundary physical-net intervals from proper-layer dummy chains.
- Allocate lanes with deterministic interval colouring.
- Assign corridor ownership to exclusive tree, shared block, component or global control structure.
- Reserve source/target escape capacity separately from long inter-layer capacity.
- If demand exceeds capacity, expand the owning inter-layer gap and rerun coordinate projection once.
- Never use a graph-size-proportional retry loop or an unrestricted outer-lane search.

Exit gate: every demand has a capacity assignment or a stable overflow diagnostic before route geometry is
generated.

## ERL-08 — Orthogonal physical-net routing

Replica routing is provider-private automatic routing; it does not call the Simple router.

- Prefer source-horizontal, channel-vertical and target-horizontal geometry.
- Route a physical net atomically with shared trunks and explicit junctions.
- Keep route orientation consistent inside a tree/corridor.
- Generate a fixed small set of geometry variants from allocated lanes.
- Validate each variant using shared orthogonal/node/overlap predicates.
- If all variants fail, report a deterministic unroutable physical net; never partially publish the net.
- Join dummy chains and restore original logical edge direction and pins.

Exit gate: both focused scenarios have zero missing routes, zero disconnected wire routes and zero hard
validation violations.

## ERL-09 — Whole and performance hardening

- Run ordinary unit, determinism and fixture invariant suites.
- Run `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases`.
- Run `npm run benchmark` and mapped benchmarks on `mfs-remote`.
- Track phase time, candidate counts, allocated lanes, overflow, route variants and peak memory.
- Crossing reduction should remain near `O(E log V)` per bounded sweep; placement near `O(V + E)`;
  routing must use spatial/interval indexes.

Performance target: Focused may initially take up to about twice vendored ELK time, but must have bounded
growth. Whole performance must move toward ELK without edge-count cliffs or quadratic candidate growth.

## ERL-10 — Product acceptance and replacement

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
- Same-viewport browser review passes for Simple, vendored ELK and Replica.

Passing Focused gates permits exposing Replica as a user-selectable Experimental provider. Passing Whole,
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
