# ELK-inspired Simple layout and routing execution plan

Updated: 2026-09-18. Branch: `master`; next implementation branch: `dev`.

This plan tracks the work requested for improving the built-in Simple provider, using ELK Layered as a
quality reference while preserving the repository's offline, dependency-light fallback and shared
routing contracts. The primary acceptance view is `eq_012`, Focused on net `clk`, with fanin depth 1 and
fanout depth 1. No fixture name, instance name, or absolute-coordinate special cases are permitted.

| ID | Phase | Objective and planned action | Inputs / dependencies | Expected output and acceptance | Risk | Status | Last update |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ELK-S01 | Baseline | Reproduce the exact eq012 Focused view under Simple and ELK; capture hard violations, routing status, quality metrics, topology and screenshots/geometry where practical. | `eq_012_mapped.v`, existing workspace/query pipeline, current `master` baseline carried into `dev` | Reproducible commands and metrics recorded in `docs/experiments/eq012-simple-elk-baseline.md`; existing failures classified without changing code | Existing tests may encode stale failure budgets; async ELK needs a controlled runner | complete | 2026-09-15 |
| ELK-S02 | Research | Inspect vendored ELK 0.11.1 integration and upstream ELK Layered implementation/docs for layering, crossing minimization, node placement, ports and orthogonal edge routing. Distinguish observed implementation facts from inference. | Vendored source, official Eclipse ELK sources/documentation | `docs/research/elk-layered-layout-routing.md` contains pinned sources, algorithm map, applicable mechanisms and rejected/non-transferable parts | Bundled JS is compiled; upstream code/version mapping may differ | complete | 2026-09-15 |
| ELK-S03 | Design | Convert the baseline and research into a bounded, deterministic Simple-provider design with explicit hard/soft goals and testable stages. | ELK-S01, ELK-S02, current routing remediation records | Roadmap records falsifiable hypotheses, metrics, complexity bounds, implementation order and stop conditions | A cosmetic placement change may expose insufficient route capacity | complete | 2026-09-15 |
| ELK-S04 | Proper layered graph | Add explicit reversible cycle orientation, minimal-span layering, physical-net-aware long-edge carriers, and atomic join-back before aesthetic placement work. Keep incomplete stages opt-in. | ELK-S03, physical-net grouping, shared validator | Both acceptance scenarios pass hard routing gates; every carrier segment spans one column; full unit suite remains green | Per-logical-edge dummies can explode lanes; partial phases can invalidate legacy routing | completed | 2026-09-18 |
| ELK-S05 | Routing | Integrate placement-aware channel/lane planning and bounded routing changes needed to eliminate eq012 unroutable output without weakening hard validation. | ELK-S03/04, shared orthogonal contract, segment indexes, physical-net routing | eq012 target view has zero missing/disconnected routes and zero hard layout violations; route search remains bounded | Full mapped corpus contains known historical failures and may require additional general fixes | completed | 2026-09-18 |
| ELK-S06 | Verification | Run focused tests, layout determinism/fixtures, full unit suite, mapped cases with no collapse, benchmark, and visual browser comparison. | ELK-S04/05 | Required suites and exact results recorded; regressions fixed or explicitly blocked, not hidden by budgets | Remote/browser environments may need adaptation | completed | 2026-09-18 |
| ELK-S07 | Delivery | Review diff, commit only task-owned paths on `dev`, merge the completed branch into `master`, and verify final status. | All prior steps completed | Reviewable commits; `master` contains the verified implementation while preserving `.vscode/settings.json` as user-owned | Merge must not include unrelated local edits | completed | 2026-09-18 |
| ELK-S08 | Visual baseline | Freeze branch/symmetry/whitespace/net-regularity diagnostics and same-viewport browser evidence for `_1471_` 3/3. | Current Simple/ELK comparison runner and positioned graphs | Metrics can reject a centered tight stack and identify ELK's multi-layer branch grouping | Aggregate metrics may hide local DFF packing | completed | 2026-09-18 |
| ELK-S09 | Branch model | Build deterministic multi-layer branch decomposition over the layered graph and physical carriers. | ELK-S08, reversible layering, carrier ownership | Stable branch blocks and sibling order under permutations; no fixture identity | Shared/cross-branch nodes need explicit ownership | completed | 2026-09-18 |
| ELK-S10 | Symmetric placement | Allocate vertical slack between branch blocks around a root spine instead of minimum-gap column packing. | ELK-S09 | `_1471_` right-side DFFs form readable branch-aligned groups; symmetry metrics improve toward ELK | Height may grow or routing channels may tighten | completed | 2026-09-18 |
| ELK-S11 | Regular routing | Reserve branch trunks/channels and enforce consistent H-V-H taps through existing bounded validation. | ELK-S09/10, shared router/validator | Regular sibling routes, 0 missing and 0 hard violations, bounded outer fallback | Placement and routing objectives may conflict | completed | 2026-09-18 |
| ELK-S12 | Strict acceptance | Run focused, determinism, full, mapped, benchmark and same-viewport browser review; deliver only if visual gate passes. | ELK-S08 through S11 | Machine gates plus visibly orderly/symmetric `_1471_`; otherwise remain in progress | Numerical pass must not substitute for visual failure | completed | 2026-09-18 |

## Current acceptance contract

- Primary graph: `tests/fixtures/mapped/equal/eq_012_mapped.v`.
- Scenario A: root net `clk`, Focused, fanin depth `1`, fanout depth `1`.
- Scenario B: root cell `_1471_`, Focused, fanin depth `3`, fanout depth `3`.
- Both scenarios use full graph semantics (no group collapse).
- Golden reference: ELK Layered quality and visual balance, not byte-for-byte coordinates or routes.
- Hard gate: all displayed targets are connected; no `missing-route`, `wire-route-disconnected`, node-body
  crossing, wrong-side attachment, non-orthogonal segment, or foreign-net collinear overlap.
- Soft comparison: balanced layer centers, reduced top-origin bias, fewer crossings/bends/outer detours,
  compact but readable bounds, and deterministic geometry under input permutations.
- Complexity gate: no graph-size-proportional candidate retry budget, all-pairs route scan, or fixture-specific
  condition. Candidate and lane limits remain named policy values.
- Strict visual gate for Scenario B: the right-side DFFs and their data logic must form coherent multi-layer
  branch blocks with balanced whitespace and regular trunks/taps. A centered minimum-gap DFF stack is a
  failure even when bounds, routability and aggregate score pass.
- Detailed next-round design and stopping rules: `docs/plans/elk-symmetric-branch-development.md`.

## Plan-change rule

Any material change to scope or algorithm will be recorded here before implementation and explained in
`docs/progress/work-log.md`, including evidence, rejected alternatives and impact on the acceptance contract.
