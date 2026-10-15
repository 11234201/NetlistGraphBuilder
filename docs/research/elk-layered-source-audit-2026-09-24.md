# ELK Layered source audit for a clean Native replacement

Date: 2026-09-24  
Upstream commit: `28e5173243cab0cf4e2c9816c803bc0d5c47ab24`  
Runtime reference: vendored `elkjs@0.11.1`  
Scope: processor assembly and the complete scoped P1-P5 layout/routing pipeline.

This audit exists because the current Native implementation reached routing correctness but not ELK-level
visual quality. It is not a justification for another local spacing pass. Facts below come from the pinned
ELK Java source read with `git show <commit>:<path>`; adaptations and hypotheses are labelled separately.

## Baseline evidence

Exact graph: `sop_015_mapped.v`, Focused `cell:_5426_`, fanin/fanout depth 3/3, 57 nodes and 60 edges.

| Metric | ELK 0.11.1 | current Native | ratio / difference |
| --- | ---: | ---: | ---: |
| positioned width | 1,465 | 1,735 | Native +18% |
| positioned height | 3,092.5 | 3,160 | Native +2% |
| visual columns | 12 | 7 | Native loses five columns |
| total routed length | 18,654.75 | 41,274 | Native 2.21x |
| crossings | 28 | 228 | Native 8.14x |
| physical crossings | 28 | 187 | Native 6.68x |

The local 96 px subtree gap did not materially address these global differences. The first large divergence
is already visible in layering and order, before routing geometry exists.

## Verified processor contract

`GraphConfigurator.java` assembles five phases and their intermediate processors. The relevant order is:

```text
P1 cycle breaking
P2 network-simplex layering
LongEdgeSplitter before P3
P3 layer-sweep crossing minimization + port distribution
HyperedgeDummyMerger before P4 when hyperedges exist
P4 Brandes–Köpf placement
LayerSizeAndGraphHeightCalculator before P5
P5 orthogonal routing
LongEdgeJoiner after P5
```

This ordering is a contract. P3 receives a proper layered graph; P4 receives the P3 node/port order and the
merged hyperedge dummy representation; P5 receives final node coordinates and layer sizes. Reordering these
processors changes the meaning of later phases.

Default options verified in `Layered.melk` and `GraphConfigurator.java`:

- random seed: `1`;
- thoroughness: `7`;
- edge routing: orthogonal;
- orthogonal routing makes `favorStraightEdges` true unless explicitly set;
- BK edge straightening: `IMPROVE_STRAIGHTNESS`;
- BK fixed alignment: `NONE`;
- post-routing graph compaction: `NONE` by default;
- high-degree-node special treatment and node promotion are not prerequisites for the observed sop015 result.

## P1: greedy cycle breaking

Source: `p1cycles/GreedyCycleBreaker.java`.

Observed facts:

- The default strategy is `GREEDY`, using weighted indegree/outdegree from direction priorities while ignoring
  self-loops.
- It repeatedly removes sinks, then sources, then a maximum `(outdegree - indegree)` node. Upstream resolves an
  equal-outflow choice through the graph's seeded RNG.
- Edges that point backwards in the resulting mark order are reversed for layout and restored after P5 by the
  named `ReversedEdgeRestorer` processor.

Adaptation: preserve the same source/sink/max-outflow heuristic and reversible edge record, but replace the RNG tie
with a stable topology-key choice and verify the feedback edge set under graph-array permutations. The current cycle
module is evidence, not a presumed retained implementation.

## P2: network-simplex layering

Source: `p2layers/NetworkSimplexLayerer.java` and common `networksimplex` classes.

Observed facts:

- Each connected component is transformed to an `NGraph` and optimized separately.
- Every non-self edge has minimum length (`delta`) 1 and a shortness weight derived from
  `PRIORITY_SHORTNESS`.
- The objective minimizes weighted edge span subject to minimum-length constraints.
- The implementation uses a feasible-tree/network-simplex optimization, enables balancing, and limits work
  to `thoroughness * 4 * sqrt(component node count)` iterations.
- Multiple components reuse the prior layer-size profile when balancing subsequent components.

Current Native difference:

- `rank_assignment.js` starts with longest-path ranks, then performs eight local coordinate-descent sweeps.
- It has no feasible-tree/cut-value optimization, weighted shortness objective, or component layer-profile
  balancing. Its seven versus ELK's twelve sop015 visual columns proves that later placement cannot recover
  the missing rank structure.

Required adaptation:

- Reproduce the constraint/objective semantics deterministically, not ELK's object model byte for byte.
- Stable topology keys replace mutable input indexes. The result must expose objective value, iterations,
  rank count, per-edge span, and feasibility for phase-local comparison.

Tie rules verified in `alg.common.networksimplex/NetworkSimplex.java`:

- the tight tree is a linked insertion-order set;
- `minimalSlack()` retains the first edge having the smallest slack;
- `leaveEdge()` returns the first tree edge whose cut value is below `-1e-10`, not the most negative edge;
- `enterEdge()` retains the first eligible non-tree edge having minimum slack;
- graphs with at least 40 nodes peel degree-one subtrees before simplex and reattach them in reverse order;
- optional balancing moves nodes only among equally optimal feasible layers and accounts for prior component counts.

Native must establish its stable iteration order before these operations; sorting after a pivot is too late because
the first-minimum rule changes the chosen basis.

## P3: layer-sweep ordering and port distribution

Sources: `p3order/LayerSweepCrossingMinimizer.java`, `BarycenterHeuristic.java`,
`AbstractBarycenterPortDistributor` implementations, `ForsterConstraintResolver.java`, and crossing counters.

Observed facts:

- Long edges are split before P3; ordering therefore operates only across adjacent layers.
- A sweep fixes one layer and orders the next using barycentres calculated from **port ranks**, not only node
  indexes. Port order is recalculated as sweeps move across the graph.
- Unknown barycentres preserve/interpolate prior order when preordered; otherwise ELK randomizes them.
- In-layer and explicit ordering constraints are resolved after barycentric sorting.
- Forward and backward sweeps continue while crossing count improves; several seeded attempts are evaluated
  according to thoroughness and the best complete order is retained.
- Crossing counters include the graph structures P3 actually manipulates, rather than only a final node-node
  inversion count.

Current Native difference:

- `crossing_minimization.js` uses node-index medians, ignores port ranks and ordering constraints, performs a
  fixed eight alternating passes, and does not stop on the first non-improving complete sweep.
- It does not maintain multiple complete attempts or distribute ports as part of ordering.

Required adaptation:

- Implement deterministic, topology-seeded attempts instead of uncontrolled PRNG state, while retaining ELK's
  best-snapshot and improvement-loop semantics.
- P3 output must include both node order and port order; P4 cannot reconstruct port intent later.

Port distributor closure:

- `ISweepPortDistributor.create()` chooses `NodeRelativePortDistributor` or `LayerTotalPortDistributor` through the
  seeded RNG for barycentric sweeps.
- Node-relative ranks allocate each node a unit interval regardless of port count; layer-total ranks allocate an
  interval proportional to relevant port count. Both respect natural side/port iteration order.
- The deterministic adaptation will run both distributor variants as named complete P3 candidates, retain each
  candidate's node+port order, and choose by total crossings then stable serialized order. It will not attempt to
  mimic hidden RNG consumption across P1/P3/P5.

## P4: Brandes–Köpf placement

Sources: `p4nodes/bk/BKNodePlacer.java`, `BKAligner.java`, `BKCompactor.java`, `BKAlignedLayout.java`,
`NeighborhoodInformation.java`, and `ThresholdStrategy.java`.

Observed facts:

1. `markConflicts()` classifies inner long-edge segments and marks type-1/type-2 conflicts so straight dummy
   chains win against incompatible short-edge alignment.
2. `verticalAlignment()` builds four directional layouts. It considers the two median neighbours, checks the
   marked edge set, and preserves monotonic layer order while linking `root` and cyclic `align` records.
3. `insideBlockShift()` follows the actual connecting edge and computes relative node shifts from source and
   target port anchors. Node size and margins determine the block extent.
4. `BKCompactor` places whole blocks, builds sink/classes and a class constraint graph from adjacent blocks,
   then propagates class shifts with a longest-path-style solve. Its threshold strategy may trade compactness
   for additional straight edges.
5. Each candidate is checked for layer-order and overlap feasibility. With orthogonal routing's default
   straight-edge preference, ELK normally selects the feasible directional candidate with minimum height;
   it does not automatically average all four. Balanced median coordinates are used only when requested.

Current Native difference:

- No type-1/type-2 conflict marking.
- One neighbour median is unioned by rank, without ELK's port-edge record and order guard semantics.
- No `innerShift`, node margin, port-anchor alignment, sink/class graph, threshold strategy, or candidate
  feasibility rejection.
- Compaction is one local adjacent-node pass.
- The four simplified candidates are always median-combined.
- A separate `CenterRecursiveTrees()` pass is disabled whenever any dummy exists; ELK needs no such pass
  because dummy nodes participate in alignment blocks.
- `structure_packing.js` adds Focused ownership and `groupGap` after ordering. ELK's observed separation is
  emergent from P2-P4 and does not require application-level tree identity.

Conclusion: the current file is not a reduced but semantically equivalent BK implementation. It shares the
four-direction vocabulary while omitting the mechanisms that create ELK's visible structure.

Spacing closure from `options/Spacings.java`:

- normal/normal uses node-node spacing;
- normal/long-edge uses edge-node spacing;
- long-edge/long-edge uses edge-edge spacing;
- external-port pairs use port-port spacing;
- each pair takes the maximum of per-node overrides, otherwise the graph default.

These type-pair rules belong in the BK constraint graph. A single real/dummy gap scalar is not equivalent.

## P5: complete orthogonal routing audit

Sources: `p5edges/OrthogonalEdgeRouter.java`; `orthogonal/OrthogonalRoutingGenerator.java`,
`HyperEdgeSegment.java`, `HyperEdgeSegmentDependency.java`, `HyperEdgeCycleDetector.java`,
`HyperEdgeSegmentSplitter.java`; `direction/BaseRoutingDirectionStrategy.java` and
`WestToEastRoutingStrategy.java`; plus `LongEdgeJoiner.java`.

### Scheduling and x ownership

- Hyperedge dummy merging is scheduled before P4 by the orthogonal router configuration. Inverted ports,
  north/south ports, external ports, self-loops and labels each add named pre/postprocessors.
- Final layer heights are known before P5, but horizontal layer positions are not. `OrthogonalEdgeRouter`
  walks boundaries from west to east, places the completed left layer at the current `xpos`, routes the next
  boundary, and advances `xpos` by the actual slot demand.
- Boundary width is `(slotCount - 1) * edgeEdgeSpacing`, plus edge-node spacing on each real side, clamped to
  node-node spacing between two non-external layers. If every edge is straight, ordinary node-node spacing is
  used. Therefore routing, not P4, owns final x coordinates and graph width.

### Hyperedge segment construction

- For each boundary, segment construction starts from output ports on the east side of the left layer and west
  side of the right layer.
- `HyperEdgeSegment.addPortPositions()` recursively traverses connected ports. One connected port component
  becomes one segment/trunk, with sorted unique incoming and outgoing y coordinates and an extent spanning both.
- A segment is straight when start and end coordinates are equal. Straight segments consume no routing slot and
  create no dependency.

### Dependency graph

- The critical-conflict threshold is `0.2 *` the minimum distinct spacing among same-side horizontal connection
  coordinates for that boundary. The ordinary conflict threshold is `0.5 * edgeSpacing`.
- For each non-straight segment pair, ELK evaluates both left/right orders. Near overlaps create conflicts;
  overlap inside the critical threshold creates a mandatory critical dependency.
- Otherwise each ordering receives `1 * conflicts + 16 * crossings`. The lower-cost ordering becomes a weighted
  dependency. Equal nonzero costs create a zero-weight two-cycle.
- Upstream ELK checks every segment pair. This exact quadratic rule is the semantic oracle. A production
  adaptation may index candidate pairs for scale only after bounded exhaustive tests prove identical dependencies.

### Cycle handling and splitting

- With at least two critical dependencies, `HyperEdgeCycleDetector` first finds a feedback set restricted to
  critical dependencies. It uses the Eades–Lin–Smyth source/sink/max-outflow heuristic; upstream breaks equal
  max-outflow ties with the seeded RNG.
- Critical feedback dependencies are not reversed. `HyperEdgeSegmentSplitter` splits involved segments into an
  incoming trunk and outgoing trunk joined through a free horizontal area.
- Free areas are derived from sorted horizontal connection coordinates. Candidate areas are rated first by added
  crossings, then dependencies, then available size. Splitting clears stale dependencies and rebuilds the affected
  relationship graph, including mandatory order through the segment that caused the split.
- Non-critical cycles are then detected. Zero-weight dependencies are removed; other selected dependencies are
  reversed. Critical dependencies are protected from this pass.

### Slots, bends and junctions

- Kahn-style topological numbering assigns each dependency target at least `source slot + 1`.
- Segments whose horizontal connections all point right are subsequently compacted toward the rightmost legal
  slot, keeping back edges close to their target layer.
- `WestToEastRoutingStrategy` places a trunk at `startPos + slot * edgeSpacing`. A normal edge receives a source
  horizontal bend and target horizontal bend; a split segment receives two additional bends at the selected split y.
- Junction points are attached while materializing shared trunk endpoints. After boundary routing, long-edge dummy
  chains are joined and semantic edge continuity is restored.

### Current Native difference and decision

- The current Native router deliberately replaced ELK's exhaustive dependency graph with a bounded indexed sweep,
  replaced seeded feedback selection with SCC-local deterministic handling, and allows unresolved/truncated
  dependency diagnostics. Full-node correctness improved, but this is not proven equivalent to ELK's order cost,
  split selection or slot compaction.
- The sop015 run still reports critical-cycle/residual-cycle diagnostics and produces 187 physical crossings versus
  ELK's 28. This cannot be attributed only to P2-P4 without a P5 oracle.
- Consequently the current `router/` is replacement scope. No module is presumed reusable. Small-boundary exact
  equivalence comes first; an indexed production implementation is accepted only when it emits the same dependency,
  split, slot and bend plan as the exact oracle on exhaustive bounded cases.

## Decisions

- Do not continue `groupGap`, recursive Focused ownership, coordinate tuning, or fixture-specific placement.
- Do not incrementally mutate the existing P2-P4 files into a mixture of old and new semantics.
- Build a new internal pipeline with explicit ports, margins, dummy types, node/port order, BK block state and
  phase diagnostics. Keep it non-default until the complete vertical slice passes.
- Reuse only boundaries whose semantics remain valid: canonical source identity, reversible cycle orientation,
  shared hard validator and render contract. No current layout or router algorithm is presumed reusable.
- Delete superseded Native ranking, crossing, placement, structure-packing and routing code at atomic cutover.

## Closed research decisions before implementation

- P1, P2 and P5 random/first-minimum choices are replaced by stable topology-key order fixed at IR construction.
- P3 runs both upstream port-distributor variants as explicit deterministic candidates and selects the measured best.
- BK uses the verified node-type pair spacing matrix rather than uniform real/dummy gaps.
- The new proper-layer IR carries typed dummy ports and original edge lineage; lossless round-trip is an ER-06 gate.
- P5 begins with an exact pairwise semantic oracle. The production index is accepted only by differential
  equivalence; truncating visually relevant dependencies is prohibited.
- P5 cycle handling must finish without an unresolved critical cycle. Stable topology keys replace upstream random
  equal-outflow choice and are checked against the oracle's cost tuple.

The source audit is complete for the project scope: flat left-to-right structural schematics with fixed west/east
ports, external boundary ports, hyperedges, reversed edges and self-loops. Compound/hierarchical-in-one-canvas ELK
processors, labels as layout nodes, wrapping and alternate directions remain explicitly out of scope because this
product projects one module boundary per canvas.

## Provenance and implementation boundary

- Upstream repository: Eclipse ELK, pinned commit above, EPL-2.0.
- The audit records behavior and source locations. The planned production implementation is independently structured
  JavaScript over this project's IR and deterministic contracts.
- No ELK Java source is copied or mechanically translated into production during planning. If that decision changes,
  implementation stops until license/notices and distribution obligations are reviewed and recorded.
- Vendored elkjs remains the executable golden provider and retains its existing license record.
- The clean implementation remains an independently structured browser-native JavaScript static package. C++ or
  WebAssembly is a possible post-acceptance compute backend only if measurements justify it; it is not a way to bypass
  the phase oracle, JavaScript reference implementation, versioned protocol or offline clone-and-run contract.

## G0 closure checklist

- **Pinned evidence:** all cited source behavior is from commit
  `28e5173243cab0cf4e2c9816c803bc0d5c47ab24`. Source inspection used commit-addressed files; the pre-existing dirty
  partial checkout was not treated as authoritative working-tree content.
- **Product scope:** flat, left-to-right module canvases; fixed west/east cell ports; external boundary ports;
  hyperedges/physical nets; reversed edges; self-loops. Compound-in-one-canvas layout, wrapping, alternate directions
  and label nodes are out of the first implementation.
- **Replacement scope:** current Native P1 cycle breaking, P2 ranking, proper-graph processing, P3 ordering, P4
  placement/structure packing and all P5 routing are evidence only and are deleted at the atomic cutover. Canonical
  identity, provider/render boundaries and the shared hard validator remain boundary assets, not algorithm reuse.
- **Implementation mode:** behavioral, independently structured JavaScript rewrite. No copied or mechanically
  translated ELK Java enters production. Any change pauses implementation for EPL-2.0 notice/distribution review.
- **Package mode:** a checked-in, self-contained ES-module static package with no install/network/native-helper step.
  C++/WebAssembly is deferred and must remain protocol-compatible if later measurements justify it.
- **Vocabulary audit:** the implementation plan describes a P1-P5 replacement throughout. The sole `P2-P4` phrase
  in its gate section is the explicit prohibition against using that obsolete narrower ticket label.

G0 is complete as of 2026-09-25. Completion opens only the remaining prework gates; it does not authorize ER-04.
