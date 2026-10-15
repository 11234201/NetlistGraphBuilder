# ELK-parity layered pipeline plan

> Frozen on 2026-09-20. This plan modified the Simple pipeline and is superseded by the independent
> [`native_layered_development.md`](native_layered_development.md) provider plan.

Date: 2026-09-15. Target branch: `dev`.
Acceptance scenarios: eq012 Focused net `clk` depth 1/1, and eq012 Focused `cell:_1471_` depth 3/3.
Supersedes `docs/plans/elk-inspired-simple-roadmap.md`.

## Why the previous plan is not enough

The previous roadmap proposed three local changes — scored layer sweeps, centered bidirectional
compaction, and measured channel width. Prototypes showed useful local improvements, but their coupled
default behavior introduced fixture regressions. They were removed from the runtime path on 2026-09-16;
the clean baseline remains 13,307 pixels wide on the `clk` scenario.

They do not fix the second scenario. On `cell:_1471_` depth 3/3 the clean baseline is still `unroutable`
with 5 missing routes and 13 hard violations, emits 123 outer routes (11.3%), and is 33,504 pixels wide
versus ELK's 6,374.

The reason is architectural. **Simple does not maintain a proper layering.** “Proper” means every edge
connects nodes in adjacent layers. ELK guarantees it with `LongEdgeSplitter` before ordering, and every
later phase is built on that guarantee. Simple never establishes it:

- `assignSimpleLevels()` produces longest-path layers and pins every boundary input to layer 0;
- no dummy nodes are inserted, so 50.3% of edges in the `_1471_` scenario span more than one layer and 512
  of them span nine;
- routing therefore has to draw cross-drawing wires, which it does through 6,128-pixel outer channels that
  no amount of local tuning can make small;
- the locality post-passes then move nodes out of their own layer column, breaking even the weak invariant
  that was left.

Every symptom the user reported — ugliness, asymmetry, unroutable edges, scattered logic — is a
consequence of that one missing invariant plus the maximum-spread layering choice that feeds it. Patching
the consequences is what produced the current partial result. This plan changes the pipeline instead.

## Target architecture

Create `src/layout/layered/` as the home of a Sugiyama pipeline with the same phase boundaries as ELK,
written as project-native code and reusing the existing router, validator and spacing policy.

```
graph
  -> P1 cycleBreaking          (new explicit reversible edge orientation)
  -> P2 minimalSpanLayering    (new: replaces assignSimpleLevels)
  -> P2.5 longEdgeDummies      (new: split, establishes proper layering)
  -> P3 layerSweepOrdering     (evolve simpleLayering.orderSimpleLayers)
  -> P4 bkPlacement            (new: replaces placeInitialNodes + compaction stages)
  -> P5 gapRouting             (evolve channelCapacity; assigns x during the scan)
  -> P5.5 joinDummies          (new: stitch chains back into polylines)
  -> domain refinement         (existing locality/hub/terminal passes, now y-only by default)
  -> validation                (unchanged shared boundary)
```

Boundary rules:

- Netlist IR is not mutated. Dummies are layout-internal objects with a topology key; they never enter the
  graph contract handed back to the UI.
- Routing and capacity operate on physical-net groups, not one independent long-edge lane per logical
  edge. `simpleOrthogonalRouter` remains the geometry/validation boundary for final real edges.
- The shared orthogonal validator and physical-net tree router stay authoritative. ELK's pairwise segment
  dependency graph is not adopted.
- Manual node overrides remain the final explicit step and are not inputs to any automatic phase.

## Stage 0.5 — explicit cycle normalization

The current longest-path pass leaves cycle-broken edges implicit: an edge whose endpoints receive the
same or reversed level is simply excluded later. That is insufficient for a proper layered graph because
there is no reversible orientation record to carry through splitting and join-back.

Create a layout-internal oriented-edge view with `reversedForLayout` metadata. Cycle breaking must use
canonical topology keys, layering and dummy splitting consume the oriented endpoints, and final routing
restores the real source/target and port semantics. Tests must cover feedback cycles, restoration, and
node/edge permutation invariance. Back edges may still use a bounded outer fallback only after the
oriented layered candidate fails validation.

## Stage 1 — minimal-total-span layering

Replace longest-path ranking with the Gansner–Koutsofios–North–Vo objective: minimize
`sum(weight_e * (layer(target) - layer(source)))` subject to `layer(target) - layer(source) >= 1`.

Implementation choice, in order of preference:

1. Deterministic network simplex. Build the initial feasible spanning tree from a canonical traversal
   (nodes sorted by topology key, not array order), select entering and leaving edges canonically, and use
   a fixed iteration limit `K * sqrt(componentSize)` with `K` a named constant. Add
   `withPreviousLayering`-equivalent behaviour so later connected components align to earlier ones.
2. If permutation determinism cannot be proven for the simplex, fall back to a canonically ordered
   Gauss–Seidel relaxation over the same constraints: repeatedly move each node, in canonical order, to
   the weighted median of its neighbours subject to the separation constraint, for a fixed number of
   rounds. Canonical traversal makes the result permutation-stable; Gauss-Seidel itself is not
   traversal-order independent.

Also replace the hard `isExternalLevelSource()` pin with a named `boundaryAnchor` policy
(`constrained` | `source`), defaulting to `constrained`, so focus-inputs get their layer from the
optimisation instead of being forced to 0.

- Evidence: total edge span 5,237 → 3,686 (-30%) on `_1471_`; ELK puts 256 boundary inputs next to their
  targets where Simple piles all 318 into layer 0.
- Complexity: simplex is bounded by the iteration limit; the current relaxation is
  `O(rounds * (V log V + E))` because it sorts movable nodes each sweep. Both are
  fixed-bound, no graph-size-proportional retry loops.
- Tests: proper-layering invariant on synthetic graphs with known optima; permutation equality; a unit
  test asserting a boundary input feeding a deep cell is not placed at layer 0; existing `clk` scenario
  must not regress.
- Integration rule: this phase stays disabled by default until Stage 2 routing is complete and the full
  unit suite passes. An individually beneficial metric is not sufficient to enter the default path.
- Stop condition: revert to longest path if the simplex cannot be made permutation-deterministic within
  the stage budget.

## Stage 2 — long-edge dummy nodes

Build two related views instead of treating every logical branch as an independent wire lane:

1. logical dummy references let every long branch participate in crossing minimization;
2. one physical-net carrier per `(physicalNetKey, boundary)` owns placement clearance, capacity and the
   routed trunk. Logical branches attach to that carrier tree.

The physical key must come from the existing physical-net grouping boundary. Reserving one placement
lane for every logical `clk`/`rst_n` branch would reproduce the lane explosion this work is meant to
remove.

The current `longEdgeDummies.js` is therefore an ordering primitive, not the final Stage 2 data model: it
creates per-edge logical dummies and intentionally remains disabled. Stage 2 is complete only after the
physical carrier representation and atomic tree join-back exist.

After P5, stitch each chain back into a single polyline with collinear point compaction, and attach the
result to the original edge.

- This is the change that removes the outer channels. Long logical branches are redistributed over their
  inter-layer gaps, while shared nets reuse one carrier trunk in each gap.
- Complexity: dummies are `O(sum of edge spans)`. For `_1471_` that is roughly 3,700 virtual nodes, which
  is bounded by the measured total span, not by `V * E`. Add a hard cap and a diagnostic when the cap is
  hit rather than silently degrading.
- Tests: every layered segment spans one column; carrier ownership is unique per physical net and gap;
  chain join-back reaches every original target; a long edge affects every crossed layer; permutation
  determinism; `clk`/`rst_n` do not allocate one lane per logical branch.
- Stop condition: if dummies blow up ordering cost beyond the benchmark budget, restrict dummy
  participation to ordering and placement and keep the join-back at routing only.

## Stage 3 — ordering on the proper graph

Move `orderSimpleLayers` onto the layered graph so it sees dummies. Three additions on top of the existing
best-of-sweeps scoring:

- use the median of neighbour ranks rather than the mean, with the mean as a stable tie break;
- include fixed port ranks in the neighbour scalar;
- prefer straight dummy chains by giving a chain's two adjacent segments a coupled preference, which is
  the project-native equivalent of BK type-1 conflicts.

- Complexity: unchanged `O(R * (V log V + E log E))` with fixed `R`, now over dummies as well.
- Tests: crossing score never increases versus the current implementation on both scenarios; permutation
  determinism; a long edge changes the order of an intermediate layer it crosses.

## Stage 4 — BK-style placement

Replace `placeInitialNodes()` plus the ad-hoc compaction stages with a Brandes–Köpf-style placer:

1. mark type-1 conflicts, favouring straight dummy chains;
2. select median neighbours while preserving non-crossing vertical alignment;
3. build alignment blocks and record the port-anchor shift inside each block;
4. compact blocks bidirectionally subject to separation, honouring variable heights and margins;
5. evaluate four directional variants and keep the feasible one with the smallest height, matching
   `favorStraightEdges = true`.

Keep the existing isotonic (pool-adjacent-violators) compaction as the block-compaction primitive — it is
already the right tool — but drive it from alignment blocks instead of from raw initial rows.

- Evidence: the current centered initial placement plus PAV compaction already removed the common-top
  bias; BK adds straight chains and global block coherence, which is what produces the symmetry the user
  sees in ELK.
- Tests: no overlaps, no margin violations, layer order preserved; straight dummy chains stay straight;
  height does not grow materially versus today; permutation determinism.

## Stage 5 — routing-driven x assignment

Delete the preallocation in `computeLevelXs()`. Adopt ELK's scan: place the layer at the current x, route
its right-hand gap with the existing physical-net interval allocator, and derive the next layer's x from
the slot count actually used:

```
gap = max(nodeNodeSpacing, (slots - 1) * edgeEdgeSpacing + edgeNodeSpacing * ends)
```

Straight segments consume no slot. Because the scan is single-pass and each gap is measured once, this is
`O(sum of gap demands)` and stays inside the existing bounded-routing contract. The Wire spacing control
continues to work through the same `requiredInterLayerGap()` boundary.

- Tests: increasing wire spacing still widens a genuinely multi-lane gap; a high-fanout boundary does not
  produce a gap proportional to logical edge count; routes remain valid.
- Stop condition: keep a structural minimum if compaction causes hard validation failures; never
  compensate with unbounded retries.

## Stage 6 — domain refinement becomes non-destructive

The locality passes (`applyFanoutHubLocality`, `applySingleFanoutInputLocality`, `placeTerminalOutputs`)
currently move nodes horizontally out of their layer column. That is what leaves three of the six
unroutable `_1471_` edges with a 2,500-pixel vertical jump between nominally adjacent layers.

Change their default to y-only movement inside the layer column, keep x displacement behind a named
policy flag, and measure both ways on the two scenarios. The passes stay — they carry real domain value —
but they must stop violating the invariant that routing depends on.

## Acceptance gates

Scenario A — eq012 Focused net `clk`, depth 1/1 (clean baseline):

- 0 missing routes, 0 hard validation violations.
- Width target is at or below the ELK reference of 8,524 (clean baseline: 13,307).

Scenario B — eq012 Focused `cell:_1471_`, depth 3/3 (currently failing):

- 0 missing routes and 0 hard validation violations. Clean baseline: 5 and 13.
- Outer routes below 5% of all routes. Clean baseline: 11.3%.
- Total edge span at or below the ELK reference of 3,686. Today: 5,237.
- Crossings at or below 1.5x the ELK reference of 31,878. Today: 62,959.

Global gates:

- No incomplete stage may be enabled by default while `npm test` is red.
- Permutation determinism: identical coordinates and route geometry under node/edge permutation.
- `npm test`, plus `layout-determinism` and `layout-fixtures` for every layout change.
- `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases`, with failures investigated rather than hidden.
- `npm run benchmark` before and after each stage; no size cliff, no unbounded candidate growth.
- No instance-name, fixture-name or coordinate special cases.

## Ordering and risks

Stages 1 and 2 are the load-bearing changes and must land before any aesthetic work. Stage 2 is also the
highest risk because it changes what every later phase sees; it therefore carries its own revert point and
the invariant test ships with it, not after it.

| Risk | Mitigation |
| --- | --- |
| Network simplex is not permutation-deterministic | Canonical traversal and tie-breaks; fall back to the deterministic relaxation in Stage 1 |
| Dummy count explodes on deep cones | Hard cap plus diagnostic; dummy participation is stageable |
| Removing x-displacing locality regresses hub readability | Policy flag with measured A/B on both scenarios |
| BK height grows versus today | Keep the current placer as a named fallback variant |
| Outer channels shrink without dummies and cause new failures | Stage 5 keeps a structural minimum and the validator stays authoritative |

## Out of scope

ELK's pairwise hyperedge dependency graph (O(m^2) cliff), seeded random restarts, post-compaction (ELK
ships it disabled), node promotion (ELK ships it disabled), high-degree-node treatment (ELK ships it
disabled), group collapse (retired from product scope), and any byte-for-byte coordinate match with ELK.
ELK's own adapter output has six endpoint violations on this scenario, so ELK is a placement and ordering
golden, not a route-geometry oracle.
