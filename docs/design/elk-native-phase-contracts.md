# ELK-native P0-P5 phase contracts

Date: 2026-09-25  
Contract version: 1.1.0  
Snapshot schema: `docs/design/elk-native-phase-snapshot.schema.json`  
Status: G3 contract freeze complete for ER-04 entry; semantic changes require a version bump.

## Package boundary

### Versioned H08 profile extension (package 0.3.0)

The base IR and baseline phase oracle retain contract 1.1.0. The explicit `h08` semantic profile is
versioned separately as 1.0.0 and is exposed through `src/layout/elk_native/h08.js`. This entry requires
only browser-native relative ES modules. It fixes structural ordering identity, per-edge implicit
endpoint identity, bounded P3 group candidates/unit sweeps and exact physical-anchor P5 adjacency.
It does not change baseline default behavior or the Simple application default.

P0 validates and snapshots public `{nodeId,membershipKey}` hints before async observation. Complete
results record immutable `phaseData.profile` with profile version, normalized hints and their digest;
the adapter retains this in `layoutMetrics.profile`. Full canonical input provenance remains separate
from the structural ordering digest. `ORDER_GROUP_POLICY` is the single source for group-band tolerance
and candidate limit; both algorithms and profile metadata consume it. Widening the grouped forecast's
self-loop/merged-column scope requires a new reviewed profile version, not a fallback or magic range.

The snapshot schema's extensible phaseData/resolvedOptions fields carry profile evidence; the normalized
base node/port/edge schema is unchanged. Research source compilation is a test control, never a shipping
dependency. Package acceptance and UI/release promotion remain gated by the independent checklist.

The accepted implementation is a self-contained browser-native JavaScript ES-module package. A clone of the
repository must be able to import its public entry without package installation, code generation, a native helper or
network access. The package owns P0 through P5 and exposes one asynchronous/cancellable layout operation plus test-only
phase observation. The application adapter owns parser/query conversion and render conversion; neither owns an
algorithmic repair pass.

The public result is published only after P5 validation. Intermediate objects are immutable at phase boundaries and
are never exposed as a partially usable layout. A possible future C++/WebAssembly backend implements this same
contract and is differential-tested against the JavaScript reference; it does not define a second protocol.

## Cross-phase ownership rules

| Data | Created by | May change in | Must survive through |
| --- | --- | --- | --- |
| canonical node/port/logical-edge IDs and display names | application adapter/P0 | never | render/export |
| physical-net ID and logical-edge membership | P0 | never | P5 restoration and validator |
| original source/target ports and direction | P0 | never | P5 restoration |
| working orientation and reversed flag | P1 | P1; restored only after P5 geometry | P5 restoration |
| layer index | P2 | proper-graph processors may insert layers but not reinterpret rank intent | P5 |
| dummy type, split segment and lineage | proper graph between P2/P3 | merge/split processors under explicit lineage operations | P5 join |
| node and port order | P3 | never after P3 | P4/P5 |
| y, block records and margins | P4 | P4 only | P5/render |
| boundary slots, x and route geometry | P5 | P5 only | render/export |
| manual override | application override layer | never inside P0-P5 | post-layout workspace |

No phase may read the parser output, query graph or a later-phase cache privately. Every required value is present in
its declared input. Diagnostics identify the first violated phase and invariant; they do not repair or publish a
fallback drawing.

## Common identity and ordering

- Canonical IDs are opaque strings. Display names are separate escaped strings and never participate in ties.
- All sets serialize in ascending canonical ID order. Ordered semantic collections (layers, node order, clockwise
  port order, route points) retain their declared order and carry explicit indices.
- Synthetic IDs are derived from stable lineage: phase, original logical-edge/physical-net IDs, boundary index and
  role. Runtime allocation order, object identity, parser statement order and input array order are forbidden.
- Floating values normalize `-0` to `0`, reject non-finite values and serialize with enough decimal precision for an
  exact JavaScript round trip. Differential comparison may apply a named coordinate tolerance only to coordinates;
  IDs, order, flags, objective tuples, dependencies and slots compare exactly.
- Every phase result contains the option set, deterministic seed, contract version and input digest.

## P0 — canonical adapter

Input: an immutable derived display graph from the shared parser→IR→analysis/query pipeline.

Output records:

- `LayerNode`: canonical ID, kind, width/height, margins, display metadata and clockwise ports;
- `LayerPort`: canonical ID, owner, side, declared order, local box/anchor and direction capability;
- `LayerEdge`: canonical ID, logical edge, physical net, original source/target ports, minimum length, priority and
  optional label lineage;
- graph policy: scope, direction, spacing policy, algorithm strategies, seed and cancellation token.

Invariants:

- all references resolve exactly once; IDs are unique; sizes/margins/anchors are finite;
- west/east fixed-port semantics are explicit; external boundary ports and self-loops are typed;
- physical-net membership is total and does not merge distinct logical edges;
- canonicalization of any node/port/edge permutation produces byte-identical normalized output.

P0 owns no rank, order, coordinate or route. It must not mutate Netlist IR or provider input.

## P1 — working orientation

Input: P0 graph. Output: the same identities plus working source/target ports and `reversed` on affected logical
edges.

The scoped algorithm is the audited greedy source/sink/max-outflow cycle breaker. Stable topology-key order replaces
upstream incidental allocation/RNG ties. Self-loops are removed into a typed side table before P1 and are not reported
as greedy feedback edges.

Invariants:

- non-self working edges form a DAG;
- reversing twice exactly restores original endpoints and port lineage;
- physical-net and logical-edge identities are unchanged;
- every feedback decision appears in `phaseData.feedbackEdges` in decision order.

## P2 — network-simplex ranks

Input: P1 DAG with minimum edge lengths and priorities. Output: a non-negative integer layer for every working node,
plus component/objective diagnostics.

`phaseData` includes feasible ranks, tight-tree membership, cut values, pivot tuples, component shifts and final
weighted-span objective. The exact bounded test reference and production implementation must emit the same normalized
objective and ranks under the declared stable tie rules.

Invariants:

- `rank(target) - rank(source) >= minLength` for every working edge;
- each connected component has minimum rank zero after normalization and no empty internal layer unless an explicit
  processor contract creates one;
- termination is an optimum or the feasible tight-tree solution retained at the audited ELK iteration budget;
  `optimal`, `termination`, pivot/zero-shift/negative-cut counts distinguish these outcomes. No second ranker or
  longest-path fallback runs. Feasibility, complete P5 routing and all hard geometry gates still apply before publication.

## Proper graph — P2/P3 boundary

Each edge spanning more than one layer is replaced by adjacent-layer segments and typed long-edge nodes/ports.
Lineage records the original logical edge, physical net, segment ordinal and predecessor/successor. External ports,
north/south helpers, labels and self-loops use separate typed processors; a long-edge dummy cannot impersonate them.

Invariants:

- every P3 inter-layer edge spans exactly one layer;
- joining every chain reconstructs the exact original endpoints and logical/physical identities;
- split/merge operations are atomic and preserve a deterministic, acyclic lineage graph.

## P3 — node and port order

Input: proper layered graph. Output: every layer's total node order and every node's clockwise port order.

The phase records each complete retained attempt: distributor variant, sweep direction, deterministic perturbation
key, node/port orders and crossing tuple. Constraints and barycentres are data, not coordinate inferences. The selected
attempt minimizes the declared crossing tuple and then the canonical serialization.

Invariants:

- every node occurs in exactly one layer and position; every port occurs once on its owner;
- fixed port order and explicit in-layer constraints are satisfied;
- selected crossing count is no worse than the initial complete order;
- P3 writes no x/y coordinates and P4 cannot reorder nodes or ports.

## Hyperedge dummy merge — P3/P4 boundary

Compatible same-physical-net long-edge dummies may merge only through an explicit equivalence record. The record lists
all consumed dummy/segment IDs and the produced shared dummy. Restoration remains one-to-many and lossless; no logical
edge disappears because geometry later shares a trunk.

## P4 — Brandes–Köpf y placement

Input: fixed P3 layer/node/port order, node sizes, margins, anchors and the node-type spacing matrix. Output: node y
coordinates and complete candidate evidence.

For each of four directional candidates, `phaseData` records type-1/type-2 conflicts, ordered neighbourhood records,
`root`, `align`, `innerShift`, block extents, `sink`, `shift`, class constraints, final y values, feasibility and height.
The selected candidate follows the audited option policy and deterministic tie tuple; a post-placement tree/group-gap
pass is forbidden.

Invariants:

- layer order is unchanged and margin boxes do not overlap under the type-pair spacing rule;
- aligned port anchors coincide within coordinate tolerance;
- every selected node y is explained by a candidate/block/class record;
- P4 writes no final layer x or edge route.

## P5 — orthogonal boundary routing and restoration

Input: fixed P4 y geometry and P3 order/lineage. Output: layer x positions, graph width, orthogonal route geometry,
junctions and restored logical edges.

For each layer boundary, `phaseData` records sorted hyperedge segments, y extents, pairwise cost tuples, dependency
edges, critical feedback decisions, split plans/free areas, rebuilt dependencies, topological slots, rightward
compaction and boundary width. Final records map materialized bends/junctions back through long-edge and reversal
lineage.

Invariants:

- all critical dependency cycles are resolved; accepted output has no truncation or unresolved-cycle diagnostic;
- dependency multiset, split tuple, slot and width match the exact bounded reference on oracle cases;
- routes are finite and orthogonal, attach to the declared anchors, avoid foreign node interiors and restore every
  logical edge exactly once while permitting shared physical-net geometry;
- P5 owns final x and graph width. No renderer or provider wrapper may move nodes or repair wires afterward.

## Diagnostics, cancellation and memory

- Diagnostics are structured as `{phase, invariant, entityIds, detail}` and sorted by phase then canonical IDs.
- Cancellation is checked before every phase and inside any potentially long bounded iteration or boundary loop.
  Cancellation returns no layout result and never caches a partial phase as reusable output.
- Reference algorithms may be deliberately exhaustive only under manifest-declared small bounds. Production loops
  state their complexity and hard semantic bound; retry budgets, approximate fallbacks and all-pairs work on unbounded
  product graphs are prohibited.
- A phase may release predecessor-only scratch data after its normalized snapshot and downstream-owned fields are
  committed. Canonical identities, lineage, selected objective evidence and diagnostics survive through validation.
- Large snapshots are test/research output, never enabled in normal UI execution. Observation must not alter order,
  RNG consumption, cancellation cadence or selected results.

## Snapshot and review contract

The JSON schema describes a snapshot set from one fixture/run. A producer may emit an `after` snapshot for every ELK
processor, but must additionally label the named phase boundaries. `phaseData` is phase-specific and versioned by the
top-level contract; adding or changing comparator-visible fields requires a schema/contract version change.

ER-04 may consume these contracts only after the upstream oracle has produced a schema-valid `oracle_smoke_001`
snapshot set containing imported, P1, P2, long-edge, P3, merge, P4, P5 and restored/final milestones. Fine-grained
P3/P4/P5 evidence remains mandatory before those respective production phases can pass review.
