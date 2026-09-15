# ELK Layered layout and routing research

Status: source-verified at the pinned ELK commit. Access date: 2026-09-15.

This note maps the vendored ELK 0.11.1 Layered implementation to the repository's Simple layout
pipeline. “Observed” means verified in the pinned ELK source or in a measured run; “inference” means an
explanation that still needs a Simple-provider experiment.

## Version and source boundary

The runtime golden remains the already-vendored `elkjs` 0.11.1 bundle. The official elkjs 0.11.1 release
states that it is based on ELK commit `28e5173243cab0cf4e2c9816c803bc0d5c47ab24`; source inspection is
pinned to that commit under `/home/wzh/open_source/elk-research-28e5173`.

No Java source, build product, package, or network dependency is added to this repository. The source
checkout exists only to make the algorithm study auditable instead of inferring behavior from a minified
JavaScript bundle. ELK is EPL-2.0 licensed; this implementation transfers algorithmic structure and writes
new project-native code rather than copying ELK source.

## Official references

- [ELK Layered algorithm reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)
- [Layered algorithm overview](https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html)
- [ELK algorithm implementation structure](https://eclipse.dev/elk/documentation/algorithmdevelopers/algorithmimplementation/algorithmstructure.html)
- [elkjs releases](https://github.com/kieler/elkjs/releases)
- [ElkLayered.java](https://github.com/eclipse-elk/elk/blob/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered/ElkLayered.java)

## The five phases and the processor chain

ELK Layered is a Sugiyama pipeline. `ElkLayered` executes five phases; `GraphConfigurator` assembles
intermediate processors around them and attaches the resulting list to the graph.

| Phase | Default implementation | Responsibility |
| --- | --- | --- |
| P1 cycle breaking | `GreedyCycleBreaker` | Reverse a bounded set of feedback edges so the graph is acyclic |
| P2 layering | `NetworkSimplexLayerer` | Assign each node a layer index |
| P3 node ordering | `LayerSweepCrossingMinimizer` | Order nodes within each layer to reduce crossings |
| P4 node placement | `BKNodePlacer` | Assign y coordinates |
| P5 edge routing | `OrthogonalEdgeRouter` | Assign x coordinates and bend points |

`GraphConfigurator` always adds four processors: `INNERMOST_NODE_MARGIN_CALCULATOR` and
`LABEL_AND_NODE_SIZE_PROCESSOR` before P4, `LAYER_SIZE_AND_GRAPH_HEIGHT_CALCULATOR` before P5, and
`END_LABEL_SORTER` after P5. `PORT_SIDE_PROCESSOR` runs before P3 when feedback edges are off, which is
the default.

Conditional additions that matter for this project:

- `NODE_PROMOTION` before P3, only when `layering.nodePromotion.strategy != NONE`. Default is `NONE`, so
  node promotion does **not** explain the golden result.
- `HIGH_DEGREE_NODE_LAYER_PROCESSOR` before P3, only when `highDegreeNodes.treatment` is true. Default is
  `false`, so high-degree handling is also not part of the golden result.
- `TWO_SIDED_GREEDY_SWITCH` before P4, but only when the graph has fewer nodes than
  `crossingMinimization.greedySwitch.activationThreshold`, whose default is `40`. Both eq012 scenarios have
  hundreds of nodes, so greedy switch is **inactive** for our acceptance cases.
- `HORIZONTAL_COMPACTOR` after P5 when `compaction.postCompaction.strategy != NONE`. Default is `NONE`,
  so ELK's golden output is **not** post-compacted. All horizontal compactness comes from P2 and P5.

`configureGraphProperties()` defaults `NODE_PLACEMENT_FAVOR_STRAIGHT_EDGES` to `true` whenever
`EDGE_ROUTING == ORTHOGONAL`, which is what our adapter requests. It also forces
`spacing.edgeEdge` to at least `2.0`.

## P2 — Network simplex layering

`NetworkSimplexLayerer` transforms each connected component into an `NGraph`, then runs the common
`NetworkSimplex` with:

- one `NEdge` per non-self-loop edge, `delta = 1`, `weight = 1 * max(1, PRIORITY_SHORTNESS)`;
- `withIterationLimit(thoroughness * sqrt(componentSize))` where `thoroughness = THOROUGHNESS * 4`, so the
  default `THOROUGHNESS = 7` gives `28 * sqrt(n)` iterations;
- `withPreviousLayering(previousLayeringNodeCounts)` for the second and later components, so later
  components are pushed toward matching the layer occupancy of earlier ones;
- `withBalancing(true)`.

The objective is the Gansner–Koutsofios–North–Vo formulation: minimize the weighted sum of
`layer(target) - layer(source)` subject to `layer(target) - layer(source) >= delta`.

**This is the single most important difference from Simple.** The constraint only forces a node to be at
least one layer right of its predecessors; the objective then pulls every node as far *right* as its
successors allow. Longest-path layering — which is what `assignSimpleLevels()` implements — instead anchors
every source at layer 0 and pushes every node as far right as its predecessors require, i.e. it is the
maximum-spread solution. Where a node's layer is constrained from the successor side the two disagree
sharply: a boundary input feeding a deep cell sits at layer 0 under longest path and next to its target
under network simplex.

Measured on eq012 Focused `cell:_1471_`, depth 3/3 (787 nodes, 1085 edges):

| Layering | Layers | Total edge span | Average span | Edges spanning > 1 layer |
| --- | ---: | ---: | ---: | ---: |
| Simple longest path | 12 | 5,237 | 4.827 | 546 (50.3%) |
| ELK network simplex | 14 | 3,686 | 3.397 | 551 (50.8%) |

Simple additionally forces every `input`, `focus-input`, `implicit` and `constant` node to layer 0 through
`isExternalLevelSource()`. In the same scenario all 318 focus-inputs collapse into layer 0, while ELK
spreads them over layers 0–9 and places 256 of them immediately left of their targets. This is the
mechanism behind the visible “boundary pins piled on the left with a bundle of wires shooting right across
the whole drawing” effect.

## P2.5 — Long-edge splitting (the proper-layering invariant)

`LongEdgeSplitter` runs before P3 and is what makes the layering *proper*. For every edge whose target
layer is neither the source layer nor the next one, it inserts a `NodeType.LONG_EDGE` dummy node in the
next layer and rewires the edge through it:

- the dummy gets `PORT_CONSTRAINTS = FIXED_POS`, one `WEST` input port and one `EAST` output port;
- dummy height is the edge thickness (0 by default), port y is `floor(thickness / 2)`;
- `LONG_EDGE_SOURCE` / `LONG_EDGE_TARGET` are propagated along the chain so every dummy knows the real
  endpoints;
- head labels move to the last segment.

The consequences are structural, not cosmetic:

1. P3 ordering sees one representative per crossed layer, so a long edge participates in every layer
   boundary it crosses instead of only at its two endpoints.
2. P4 can keep the chain straight; BK marks type-1 conflicts specifically to favour straight long-edge
   dummy chains.
3. P5 only ever routes unit-span edges inside one inter-layer gap. **ELK has no outer-channel concept at
   all** — a long logical edge is a chain of short gap routes, and `LongEdgeJoiner` stitches the chain back
   into one polyline after routing.

This is the root cause of the largest measured gap. In the `_1471_` depth-3/3 scenario Simple reserves
`outer-top` and `outer-bottom` channels of 6,128 pixels each for 292 demands across 256 lanes, emits 214
outer routes (19.7% of all routes) and still fails to route 6 physical nets. ELK emits **zero** outer
routes because the same long edges were decomposed into per-gap segments before routing.

## P3 — Layer sweep crossing minimization

`LayerSweepCrossingMinimizer` alternates forward and backward sweeps over adjacent layer pairs. Each sweep
treats one layer as fixed and re-sorts the free layer by a `BarycenterHeuristic` scalar derived from
neighbour positions and fixed port ranks, fills undefined values, and stably sorts. It counts crossings,
stops when a sweep stops improving, and retains the best of a bounded number of attempts controlled by
thoroughness. ELK uses small seeded perturbations (`randomSeed` default 1) to diversify attempts; the
project must not, because its layouts have to be permutation-deterministic.

The transferable invariant is “score and retain the best stable ordering”, with deterministic,
topology-keyed sweep orientations and stable ties instead of random restarts. A crossing counter can work
per adjacent boundary in `O(E log V)` using inversion counting; an all-edge-pairs counter is unnecessary.

## P4 — Brandes–Köpf node placement

BK is not layer centering. For each of four combinations of layer traversal direction and within-layer
direction it:

1. marks type-1 conflicts, favouring straight dummy-node segments of long edges;
2. selects median neighbours while preserving the ordering needed for non-crossing vertical alignment;
3. joins compatible nodes into alignment blocks and records the port-anchor shift inside a block;
4. compacts the blocks subject to adjacent-node separation, including variable node sizes and margins;
5. rejects variants that violate layer order or overlap constraints.

With `favorStraightEdges = true` — forced by orthogonal routing — the pinned implementation computes the
four variants and selects the feasible one with the smallest height. Median balancing is used only when
balanced alignment is requested, or when neither fixed alignment nor straight-edge preference selects a
single variant. `nodePlacement.bk.fixedAlignment` defaults to `NONE` and
`nodePlacement.bk.edgeStraightening` defaults to `IMPROVE_STRAIGHTNESS`.

## P5 — Orthogonal edge routing and where x comes from

`OrthogonalEdgeRouter` walks the layers left to right. For each layer it calls
`LGraphUtil.placeNodesHorizontally(layer, xpos)` and then routes the gap to the next layer:

```
startPos     = (leftLayer == null) ? xpos : xpos + edgeNodeSpacing
slotsCount   = routingGenerator.routeEdges(...)
routingWidth = (slotsCount - 1) * edgeEdgeSpacing
routingWidth += edgeNodeSpacing        if leftLayer  != null
routingWidth += edgeNodeSpacing        if rightLayer != null
routingWidth  = max(routingWidth, nodeNodeSpacing)   when both sides are real layers
xpos         += routingWidth           (or nodeNodeSpacing when the gap uses no slots)
```

Two facts matter for this project:

- **x is derived from what routing actually consumed**, not preallocated. Each layer coordinate is assigned
  as the scan proceeds.
- Straight segments never consume a slot, so a gap containing only straight edges costs just
  `nodeNodeSpacing`.

Inside `OrthogonalRoutingGenerator`, each connected port group in the gap becomes a `HyperEdgeSegment`.
Segments are ordered through a dependency graph and numbered by topological numbering; the returned slot
count is `max(routingSlot) + 1`, skipping straight segments. Cycles are broken by splitting segments
(`breakCriticalCycles`) and then by reversing or dropping non-critical dependencies.

Thresholds and penalties in `createDependencyIfNecessary`:

- a segment whose start and end coordinate differ by less than `TOLERANCE` (1e-3) is straight and is
  skipped entirely;
- `conflictThreshold = 0.5 * edgeSpacing`;
- `criticalConflictThreshold = 0.2 * minimumHorizontalSegmentDistance(...)`; a critical conflict creates a
  hard ordering dependency;
- otherwise a cost is built from `CONFLICT_PENALTY = 1` and `CROSSING_PENALTY = 16`, and the cheaper
  orientation wins.

The dependency graph is built by an **all-pairs nested loop** over segments in the gap. Copying it would
introduce an `O(m^2)` edge-count cliff and would violate this repository's bounded-routing contract. The
project already has the scalable substitute: one physical-net demand per boundary and deterministic
interval lane allocation in `O(D log D)`, followed by authoritative geometry validation. The plan should
therefore keep the existing router and let layout consume its measured capacity.

## Spacing defaults actually in force

`Layered.melk` at the pinned commit:

```
spacing.nodeNodeBetweenLayers     = 20
spacing.edgeNodeBetweenLayers     = 10
spacing.edgeEdgeBetweenLayers     = 10
thoroughness                      = 7
randomSeed                        = 1
```

`src/layout/elkLayoutProvider.js` overrides two of them: `elk.spacing.nodeNode = 40 + cellSpacing` and
`elk.layered.spacing.nodeNodeBetweenLayers = 72 + cellSpacing`. With the default `cellSpacing = 8` that is
48 and 80. Any Simple-versus-ELK width comparison therefore compares against *overridden* ELK spacing, not
ELK's stock defaults.

## Transfer decisions

- Adopt: minimal-total-span layering with boundary nodes placed by constraint rather than pinned to layer
  0; long-edge dummy nodes with a join-back stage (the proper-layering invariant); scored deterministic
  layer sweeps; port-aware alignment blocks with bidirectional compaction; x coordinates derived from
  measured routing slot usage.
- Adapt: virtual long-edge influence may live in ordering data rather than mutating Netlist IR; lane
  ordering stays interval-based rather than ELK's pairwise dependency graph; sweep diversification uses
  fixed topology-keyed orientations instead of seeded randomness. Placement and routing carriers must be
  grouped by the repository's physical-net key: copying ELK's per-edge dummy structure without ELK's
  later hyperedge merging would allocate hundreds of redundant clk/rst lanes.
- Preserve: the shared orthogonal validator, physical-net tree routing, bounded fallbacks, the manual
  override boundary, and the offline native-ES-module runtime.
- Reject: Java/elkjs runtime coupling, copied EPL source, random layout attempts, all-pairs segment
  comparison, fixture/instance-name cases, raw coordinate goldens, and group-collapse tuning.
