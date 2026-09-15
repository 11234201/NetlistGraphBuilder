# eq012 Focused `cell:_1471_` depth 3/3 baseline

Status: historical prototype measurements plus a clean-baseline recheck on 2026-09-16.

This is the second acceptance scenario added to the ELK-parity work. The first is Focused net `clk`,
depth 1/1, recorded in `docs/experiments/eq012-simple-elk-baseline.md`.

## Fixed scenario

- Fixture: `tests/fixtures/mapped/equal/eq_012_mapped.v`, module `tc`
- Focus root: `cell:_1471_`
- Fanin depth: 3, fanout depth: 3
- Providers: Simple Layered and ELK Layered (vendored 0.11.1)
- Collapse: disabled / out of product scope

## Reproduction

```
npm run analyze:eq012-layouts -- --focus-cell=_1471_ --fanin-depth=3 --fanout-depth=3
node tools/inspect_layer_spans.mjs _1471_ 3 20    # per-provider layer span histogram
node tools/inspect_long_edges.mjs _1471_ 3        # Simple long-edge histogram
node tools/inspect_unroutable.mjs _1471_ 3        # Simple unroutable edge detail
```

The query result contains 787 nodes and 1085 edges: 312 cells, 318 focus-inputs, 154 focus-outputs and
3 hubs.

## Clean baseline after the 2026-09-16 audit

The earlier 4,940-pixel Simple result included several coupled A/B/C prototypes. Those prototypes were
removed from the runtime path after they caused fixture regressions. With S1/S2 also disabled by default,
the current baseline is 33,504 x 25,952, with 5 missing routes, 13 hard violations, 123 outer routes and
33,987 routed-edge crossings. ELK remains 6,374 x 32,160 with no missing route and six adapter endpoint
violations. The tables below retain the prototype measurements as experiment history, not current defaults.

## Prototype headline results

| Metric | Simple | ELK 0.11.1 |
| --- | ---: | ---: |
| Elapsed time | 1,456.9 ms | 2,583.6 ms |
| Bounds | 4,940 x 26,016 | 6,374 x 32,160 |
| Layout status | **unroutable** | unroutable (adapter-side only) |
| Missing routes | **6** | 0 |
| Hard validation violations | **12** | 6 |
| Violation breakdown | 6 missing-route, 5 wire-route-disconnected, 1 node-crossing | 3 wrong-port-side, 3 endpoint-body-crossing |
| Routed-edge crossings | 62,959 | 31,878 |
| Average bends per edge | 1.648 | 5.696 |
| Average detour ratio | 1.250 | 1.031 |
| Outer routes | **214 (19.7%)** | 0 |
| Column count | 19 | 25 |

ELK's six violations are all on the project adapter's focus-input-to-hub attachments for `clk` and `rst_n`.
They are adapter artifacts and do not invalidate ELK as a placement golden.

### Width note

On this scenario Simple's bounding box (4,940) is *narrower* than ELK's (6,374), which does not match the
reported “Simple is stretched horizontally” impression. Two things explain the discrepancy:

1. `dist/` is a stale v1.0.1 build from 2026-09-14 and does not contain any of the current `dev` layout
   changes (verified: no `compactLevelTowardPreferredRows`, no fanout-capacity fix). A user running the
   packaged Windows app sees pre-change Simple, which is materially wider — on the `clk` scenario the same
   class of fix moved Simple from 13,307 to 1,043 pixels.
2. The perceived “stretch” is about *edge geometry*, not the bounding box. Simple draws 546 multi-layer
   edges as single long wires; the 512 of them that span nine layers cross the entire drawing. ELK draws
   the equivalent edges as chained per-gap segments that stay next to their neighbours.

## Long-edge structure (the dominant finding)

| Layering | Layers | Nodes per layer | Total span | Avg span | Span histogram |
| --- | ---: | --- | ---: | ---: | --- |
| Simple | 12 | 318, 22, 30, 18, 10, 2, 1, 1, 1, 128, 128, 128 | 5,237 | 4.827 | 1:539, 2:24, 3:7, 7:3, **9:512** |
| ELK | 14 | 2, 22, 2, 52, 35, 25, 3, 4, 1, 256, 1, 128, 128, 128 | 3,686 | 3.397 | 1:534, 2:293, 3:2, **10:256** |

- 50.3% of Simple edges span more than one layer; 512 of them span nine.
- `assignSimpleLevels()` pins all 318 focus-inputs to layer 0 via `isExternalLevelSource()`. ELK spreads
  boundary inputs across layers 0–9 and puts 256 of them immediately left of their targets.
- Network simplex reduces total edge span by 30% relative to longest path on the same graph.

## Where the 6 unroutable Simple edges come from

All six report `localOverlap: true`, meaning every candidate route intersects a node body.

| Edge | Net | Span | Geometry | Candidate count | Local crossings |
| --- | --- | ---: | --- | ---: | ---: |
| `_2258_` → `_1548_` | `data1_q[0]` | 9 | (3070,446) → (3898,424) | 4 | 5 |
| `_2543_` → `_1265_` | `salt_q[29]` | 1 | (236,3666) → (466,1116) | 1 | 35 |
| `_2563_` → `_1340_` | `salt_q[49]` | 1 | (260,1538) → (466,1880) | 19 | 7 |
| `_2564_` → `_1338_` | `_0020_` | 1 | (260,1338) → (466,3808) | 6 | 35 |
| `hub:clk` → `_1806_` | `clk` | 9 | (466,10656) → (4506,15274) | 3 | 161 |
| `hub:rst_n` → `_1808_` | `rst_n` | 9 | (466,10728) → (4506,15618) | 1 | 148 |

Three are nine-layer edges whose only option today is a cross-drawing route. The other three are
nominally unit-span but their source focus-input was displaced by the locality passes to x = 236 or 260,
far outside its own layer column, leaving a 2,500-pixel vertical jump through the cell bank.

Both groups are symptoms of the same missing invariant: Simple has no proper layering, so nothing
guarantees that an edge's endpoints are in adjacent columns at the time routing runs.

## Channel capacity

Simple's outer channels dominate the vertical budget:

| Channel | Current span | Required span | Demands | Lanes | Overflow |
| --- | ---: | ---: | ---: | ---: | ---: |
| outer-top | 80 | 6,128 | 292 | 256 | 7 |
| outer-bottom | 0 | 6,128 | 292 | 256 | 7 |
| inter-layer 1→2 | 576 | 576 | 297 | 23 | 0 |
| inter-layer 2→3 | 480 | 480 | 289 | 19 | 0 |
| inter-layer 9→10 | 480 | 480 | 130 | 19 | 0 |

The 292 long-edge demands cannot share outer lanes because their horizontal spans all overlap the whole
drawing, so the interval allocator degrades to 256 distinct lanes. This is the same capacity that
long-edge splitting would have distributed across the eleven inter-layer gaps instead.

## Consequences for the plan

This scenario is the stronger of the two acceptance cases because it reproduces the reported unroutable
state with hard evidence. It should drive the ordering of work: proper layering and long-edge dummies
first, aesthetics second.

## Stage 1 (minimal-total-span layering) — measured

`relaxToMinimalSpan()` replaced longest-path ranking behind `policy.features.minimalSpanLayering`.

| Metric | Before S1 | After S1 | ELK |
| --- | ---: | ---: | ---: |
| Bounds | 4,940 x 26,016 | 4,940 x 26,088 | 6,374 x 32,160 |
| Missing routes | 6 | **4** | 0 |
| Hard violations | 12 | **10** | 6 |
| Routed-edge crossings | 62,959 | **46,097** | 31,878 |
| Outer routes | 214 (19.7%) | **182 (16.8%)** | 0 |
| Average wire length | 8,014 | **6,316** | 5,709 |
| Multi-column edges | 546 | **273** | — |
| Required dummy nodes | — | 2,069 | — |

Total edge span dropped from 5,237 to 3,154, which is below ELK's network-simplex result of 3,686.

On the other acceptance scenario (`clk`, depth 1/1) S1 moved Simple from 261,632 to **196,608** crossings
with 0 missing routes and 0 violations, against ELK's 261,888 crossings and 4 violations. Scenario A is
already proper — all 2,050 of its edges span exactly one column — so S2 has no work to do there.

## Stage 2a (long-edge dummies for ordering only) — measured, then parked

`buildLongEdgeChains()` inserts one dummy per (edge, column) crossed and feeds the unit-span segments to
`orderSimpleLayers()`. The dummies are stripped before placement.

| Metric | S1 only | S1 + S2a | ELK |
| --- | ---: | ---: | ---: |
| Crossings | 46,097 | **31,003** | 31,878 |
| Average wire length | 6,316 | **4,663** | 5,709 |
| Missing routes | 4 | **68** | 0 |
| Hard violations | 10 | **75** | 6 |
| Outer routes | 182 | 126 | 0 |

Ordering improves sharply — crossings land just below ELK and average wire length drops 26% — but routing
collapses: 68 edges become unroutable. **59 of the 68 are `hub->cell` edges spanning nine columns**, all
reporting `localOverlap: true`.

### Why ordering alone cannot work

The optimizer now minimizes crossings of a drawing whose chains are straight. Nothing makes them straight,
because dummies do not take part in placement, so no vertical channel exists where a chain expects one. The
ordering is optimal for a geometry that is never produced.

### Why minimal-span layering cannot remove these long edges

```
hub:clk    level 1   fanout 139   -> 11 targets at level 2, 128 targets at level 10
hub:rst_n  level 1   fanout 139   -> 11 targets at level 2, 128 targets at level 10
```

A node's upper bound under minimal-span layering is `min(level(target)) - 1`. The 11 shallow targets pin
both hubs at level 1, so the 128 deep edges necessarily span nine columns. This is not a defect in the
relaxation: network simplex minimizes the same objective and is subject to the same constraint, which is
why ELK's own output carries a `10:256` span bucket. ELK absorbs those edges with dummy chains that own a
reserved channel in every layer they cross.

Worse, the chains must pass through column 8, which holds 257 real nodes — the densest column in the
drawing. There is no free space there today for 256 additional wires.

### What S2b has to add

1. Dummies stay in the buckets through placement so each chain reserves the vertical channel it owns.
2. After placement, each dummy's y is captured and the dummies are removed; the reserved gap survives.
3. The router gains a chain candidate family: a long edge is offered a multi-hop polyline through its
   chain's y values, validated by the existing `candidateIsUsable` / `routeOverlapsReserved` boundary.
   The current outer-lane route remains the fallback.

Until step 1 and 2 exist, `policy.features.longEdgeDummies` stays `false`. The module is complete and
covered by `tests/unit/long-edge-dummies.test.js` (9 tests), so turning it on is a one-line change once
S2b lands.

## Regression audit

| Test | Origin |
| --- | --- |
The pristine `master` suite passed 536/536. The mixed working tree failed three tests, so none of those
failures was pre-existing. After removing the preliminary A/B/C runtime changes and disabling incomplete
S1/S2 defaults, the expanded suite passes 553/553. S1 and later stages must repeat this clean A/B check
before being enabled.
