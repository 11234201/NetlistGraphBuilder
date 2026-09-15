# ELK-inspired Simple layout and routing work log

## 2026-09-15 19:00 +08:00 — ELK-S01 started

- Goal: establish a reproducible Simple-versus-ELK baseline for `eq_012` Focused net `clk`, fanin/fanout
  depth 1, before changing layout or routing code.
- Basis: the user reports strong ELK symmetry and severe Simple top-packed placement/unroutable behavior.
  The repository already records broad mapped `missing-route` and `wire-route-disconnected` failures, so
  the exact target view must be isolated from the full-corpus history.
- Planned actions: preserve the pre-existing `.vscode/settings.json` modification; create `dev`; read the
  repository layout contracts and prior eq012 investigations; identify or build a deterministic focused
  runner; collect layout/route metrics for both providers.
- Expected artifacts: `docs/experiments/eq012-simple-elk-baseline.md`, raw small diagnostic summaries kept
  out of Git when generated, and an updated ELK-S01 result in the execution plan.
- Acceptance: both providers use the same source graph/query/policy; results record graph size, layout
  bounds, routing status, hard violations and soft quality metrics.
- Known risks: ELK is asynchronous; existing eq012 tests may model an older root selection or spacing;
  full mapped tests have known historical failures and cannot substitute for the focused baseline.
- Actual actions so far: inspected Git status on `master`; observed only the user-owned
  `.vscode/settings.json` modification; created and switched to branch `dev`; read the global project,
  layout skill, architecture, design, Stage 8 and research-workflow constraints.
- Status: in progress.

## 2026-09-15 20:10 +08:00 — ELK-S01 deterministic baseline measured

- Added `tools/compare_eq012_layouts.mjs` and the `analyze:eq012-layouts` package script.
- Confirmed both providers receive the same 1,540-node, 2,050-edge Focused graph for net `clk`, depth
  1/1, with collapse disabled.
- Measured Simple at 13,307 x 88,324 with zero missing routes and zero hard violations. Measured ELK at
  8,524 x 98,440 with zero missing routes and four adapter-side endpoint violations.
- Identified the direct Simple placement cause: `placeInitialNodes()` resets every level to the same top
  margin and packs its nodes downward; subsequent passes only partially compensate.
- Recorded the full baseline and its interpretation in
  `docs/experiments/eq012-simple-elk-baseline.md`.
- Status: baseline measurement complete; screenshot/visual evidence remains part of implementation
  verification.

## 2026-09-15 20:25 +08:00 — ELK-S02 exact-source research started

- Verified that the repository already contains the required runtime bundle at
  `vendor/elkjs-0.11.1/lib/elk.bundled.js` and the adapter at `src/layout/elkLayoutProvider.js`.
- Matched elkjs 0.11.1 to ELK commit `28e5173243cab0cf4e2c9816c803bc0d5c47ab24` from the official
  release record.
- Created a temporary sparse source checkout only to inspect the original Java implementation, copied it
  to `/home/wzh/open_source/elk-research-28e5173`, verified the pinned commit there, and removed the local
  temporary checkout. It is research material, not a new project dependency.
- Initial source trace confirms the layered phase chain: layer assignment, layer-sweep crossing
  minimization, Brandes-Kopf node placement, and per-gap orthogonal routing through hyperedge segments.
- Status: in progress; exact transferable invariants are being extracted before Simple code changes.

## 2026-09-15 21:10 +08:00 — ELK-S01 through ELK-S03 closed

- Completed browser inspection of the exact eq012 Focused `clk` depth-1/1 scenario. ELK is retained as a
  placement/order golden; its adapter has four endpoint validation violations and a focus-navigation
  mismatch, so exact routing geometry is not an acceptance target.
- Finished the pinned ELK phase trace. The transferable mechanisms are scored layer sweeps,
  median-neighbor alignment blocks, bidirectional compaction, and post-routing-slot gap sizing. The ELK
  busy-gap pairwise dependency builder is rejected because it conflicts with the repository's bounded
  routing invariant.
- Extended the comparison runner with compact per-channel capacity evidence. The Simple hub-to-cell gap is
  12,560 pixels although the interval allocator needs three lanes and 96 pixels. Raw logical fanout
  preallocation is duplicating the later physical-net capacity plan.
- Recorded the implementation design, complexity bounds, tests, and stop conditions in
  `docs/plans/elk-inspired-simple-roadmap.md`.
- Status: ELK-S01, ELK-S02, and ELK-S03 complete; ELK-S04 implementation begins with scored ordering and
  balanced vertical compaction.

## 2026-09-15 22:00 +08:00 — second scenario measured, plan replaced

- Added the second acceptance scenario: eq012 Focused `cell:_1471_`, fanin/fanout depth 3/3 (787 nodes,
  1085 edges). Measured Simple 4,940 x 26,016 with 6 missing routes and 12 hard violations; ELK
  6,374 x 32,160 with 0 missing routes and 6 adapter-side endpoint violations.
- Re-measured the `clk` depth 1/1 scenario with change sets A–C applied: Simple is now 1,043 x 88,244 with
  0 missing routes and 0 violations, down from 13,307 wide in the pre-change baseline.
- Identified the architectural root cause: Simple does not maintain a proper layering. 50.3% of edges in
  the `_1471_` scenario span more than one layer and 512 span nine, because `assignSimpleLevels()` uses
  longest-path ranking and pins every boundary input to layer 0, and because no long-edge dummy nodes are
  inserted. The consequence is 6,128-pixel outer channels, 214 outer routes (19.7%) and 2x ELK's crossings.
- Traced all 6 unroutable edges: three are nine-layer edges, three are unit-span edges whose focus-input
  source was displaced out of its layer column by the locality passes.
- Read the pinned ELK source for `GraphConfigurator`, `LongEdgeSplitter`, `NetworkSimplexLayerer`,
  `OrthogonalEdgeRouter`, `OrthogonalRoutingGenerator` and `Layered.melk`. Confirmed the exact gap-width
  formula, that `postCompaction` / `nodePromotion` / `highDegreeNodes` are all disabled by default, and
  that greedy switch is inactive above 40 nodes.
- Rewrote `docs/research/elk-layered-layout-routing.md` at source-verified depth, added
  `docs/experiments/eq012-1471-depth3-baseline.md`, and replaced the roadmap with
  `docs/plans/elk-parity-layered-pipeline.md`, a six-stage proper-layering pipeline.
- Added `tools/inspect_layer_spans.mjs`, `tools/inspect_long_edges.mjs` and
  `tools/inspect_unroutable.mjs` with `analyze:*` npm scripts.
- Noted that `dist/` is a stale v1.0.1 build from 2026-09-14 and does not contain any current `dev`
  layout change; a packaged-app run shows pre-change Simple.
- Status: research and plan complete; no layout code changed in this step.

## 2026-09-16 — plan and implementation audit

- Verified pristine `master` at 536/536 tests and the mixed experimental working tree at 552/555. The
  three failures were introduced by the experiments; the earlier “pre-existing” classification was wrong.
- Removed the coupled A/B/C prototypes from the default runtime path and restored their changed fixture
  assertions. Kept S1 and the S2 ordering primitive as isolated research code, both disabled by default.
- Corrected `stripDummyNodes()` from a per-dummy bidirectional scan to linear nearest-real passes and kept
  partially projected edges visible to downstream diagnostics.
- Corrected the architecture: cycle breaking must produce a reversible oriented-edge view, and long-edge
  placement/routing capacity must use one carrier per physical net and boundary rather than one lane per
  logical branch. Chain routing belongs at the atomic physical-net group boundary.
- Re-measured clean defaults. Scenario A is 13,307 x 88,324 with 0 missing/0 violations. Scenario B is
  33,504 x 25,952 with 5 missing/13 violations/123 outer routes; ELK is 6,374 x 32,160 with 0 missing and
  six adapter endpoint violations.
- Expanded default suite now passes 554/554 on the isolated Linux workspace.

## 2026-09-16 — S04 cycle orientation and physical carrier foundation

- Added iterative, deterministic SCC discovery and a reversible layout-oriented edge view. Only edges
  inside a cyclic SCC may be reversed; ordinary DAG edges retain their semantic direction, and self loops
  remain available to the router while being excluded from layering constraints.
- Added one carrier record per `(physicalNetKey, occupied-column boundary)`. A 3-branch fanout crossing
  three boundaries creates three carriers, not nine, and each carrier records the logical branches still
  crossing that boundary.
- Added permutation, restoration, self-loop, fanout-sharing and invalid-direction tests. Focused layered
  tests pass 24/24; the complete default suite passes 560/560 on Linux.
- These modules are not yet connected to the default layout pipeline. The next step is a layout-internal
  `LayeredGraph` that combines oriented edges, logical ordering references and physical carriers without
  mutating Netlist IR.

## 2026-09-16 — S04 LayeredGraph assembled

- Added the layout-internal `LayeredGraph` builder. It combines reversible oriented edges, feasible
  levels, logical long-edge chains, ordered layers and physical-net carriers while retaining the original
  graph and real edges unchanged.
- Preserved the semantic physical-net key before reversing an edge for layout; otherwise a reversed
  feedback edge would be regrouped under its target and could not be restored atomically.
- Added whole-object permutation and immutability tests plus the unit-span segment invariant. The default
  provider still does not consume this structure; activation waits for carrier placement and join-back.
- Complete Linux suite: 562/562 passing.
