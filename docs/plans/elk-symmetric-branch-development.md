# ELK-style symmetric branch placement — next-round plan

Updated: 2026-09-18. Status: in_progress (SBP-02/SBP-03). Target branch: `dev`.

| Work package | Status | Current evidence |
| --- | --- | --- |
| SBP-01 visual oracle | completed | Controlled-sink columns now report minimum/median/maximum gap, large-gap count, gap variation, primary order and data-parent alignment; exact Simple/ELK baseline frozen below |
| SBP-02 branch decomposition | in_progress | Shared-control/low-fanout-data ownership identifies 267 controlled sinks deterministically; full focused branch-block ownership still experimental |
| SBP-03 symmetric placement | in_progress | Policy-owned 16-sink branch bands are selected and valid; post-placement root/block and whole-upstream-layer centering were rejected by routing gates |
| SBP-04 regular routing | planned | Existing router validates current branch-band candidate; root-spine movement still needs channel-aware routing |
| SBP-05 scoring | in_progress | Branch structure has a separate acceptance gate; final routing-aware lexicographic selection remains |
| SBP-06 verification | planned | Focused tests and full unit suite pass; mapped, benchmark and browser final gate pending |

Latest checkpoint: the accepted Simple candidate is 6,274 x 26,888 with zero missing routes and zero hard
violations. Each 128-DFF right column has seven deliberate 192-pixel inter-band gaps, and mean data-parent
alignment error is 228.195 (baseline 847.506). The branch-band size and gap now belong to normalized layout
policy rather than private placement constants. Two post-placement centering approaches remain rejected:
moving only the root/fanin block produced 130 outer-lane routes, while translating complete upstream layers
produced 27 missing/disconnected routes. SBP-03 therefore moves next to ordering-time branch blocks instead
of further coordinate repair after channel placement.

Topology audit of the rendered ELK result shows that its two 128-DFF columns use matching gap boundaries;
the dominant 5,442-pixel centre gap separates corresponding parent pairs in both columns. Simple's seven
192-pixel gaps instead follow fixed groups of sixteen stable-order nodes. Raising barycentric sweep count
from four to twelve did not change that order. The audit also exposed a horizontal dependency: Simple
localizes the 256 data boundary inputs between the `_0354_` hub and its DFF targets, while ELK keeps that
boundary column to the hub's left. Preventing localization without jointly reserving long-edge channels
created 10-12 missing data routes, so horizontal source placement and branch corridors must be solved as
one ordering/capacity decision rather than independent repairs.

## 1. Objective and non-negotiable acceptance

This round is not complete unless the Simple provider renders `eq_012`, Focused on `cell:_1471_`, fanin
depth 3 and fanout depth 3, with visibly orderly and symmetric placement and regular net geometry comparable
to the ELK Layered reference. Smaller bounds, zero unroutable edges, or a better aggregate score alone do not
constitute acceptance.

The implementation must remain topology-driven and general. It may not inspect the fixture name, `_1471_`,
specific instance names, or absolute coordinates.

### Required visual properties

1. The focus/root path defines a stable horizontal spine; corresponding fanin/fanout branches occupy
   repeatable bands around that spine.
2. Related DFFs and their data-logic cones move as multi-layer branch blocks. The right-side DFF column may
   not remain a single top-to-bottom minimum-gap stack when its branches have available vertical slack.
3. Sibling branches preserve stable order and receive balanced whitespace above and below the spine. A
   branch is not considered symmetric merely because the whole column is centered.
4. Nets leave source pins horizontally, share trunks where topology permits, turn vertically in deliberate
   channels, and enter target pins horizontally. Repeated branches use the same bend convention.
5. Long unrelated nets do not weave through branch interiors when a bounded inter-branch channel is
   available. Outer lanes remain fallback behavior, not normal branch routing.

Final acceptance includes a side-by-side browser review of Simple and ELK at the same query and fit-to-view
scale. If the Simple result still presents the right-side DFFs as a visually undifferentiated tight stack, the
round remains `in_progress` regardless of numerical metrics.

## 2. Reproducible baseline

Current Simple output uses 787 nodes and 1,085 edges, selects `balanced`, and produces 6,346 x 25,984 with
zero missing routes and zero validator violations. The selected candidate differs only slightly from legacy:

| Candidate | Height | Center spread | Port delta | Aligned edges | Score | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| legacy | 25,624 | 12,798 | 2,781,562 | 452 | 2,909,654 | rejected |
| balanced | 25,624 | 12,798 | 2,779,764 | 452 | 2,907,856 | selected |
| symmetric fanout | 19,780 | 15,607 | 6,534,870 | 5 | 6,645,204 | rejected |
| best alignment block | 28,264 | 18,530 | 10,436,074 | 79 | 10,586,190 | rejected |

Observed limitation: `applyBalancedLayerPlacement()` centers each already tightly packed layer, then runs
independent ordered-layer compaction at the minimum gap. Its symmetric preference covers only adjacent-layer
fanout and does not construct a multi-layer branch hierarchy. Consequently, the accepted result can be
mathematically centered while the DFF bank remains visually top-to-bottom packed.

SBP-01 measured the decisive local gap baseline. In the two 128-sink right-side columns, Simple had zero
large gaps (minimum/median 56 and 28; maximum 56 and 48), whereas ELK had nine large gaps per column,
minimum/median 48 and maximum 5,442. Simple's mean data-parent alignment error was 847.506 versus ELK's
42.526. These values, rather than whole-canvas centering alone, now gate visual progress.

### 2026-09-18 implementation checkpoint

The controlled-bank candidate now creates the same topology-derived centre boundary in both 128-sink DFF
columns. The default centre gap is 600 pixels (the ordinary 16-sink band gaps remain 192), canvas width stays
within 6,600, and the exact fixture remains at zero missing routes and zero validator violations. A bounded
joint carrier-variant selector prevents greedy clk/rst ordering from forcing an entire 128-edge tree onto
outer lanes; the remaining outer-lane count is two ordinary edges.

This is not the visual exit gate. Browser comparison shows that the two DFF columns now have matching
whitespace, but most of the focused combinational cone is still above that opening. Moving two or three
fanin levels independently into the opening creates layer-order obstacles and missing routes, so that
selective-node translation is rejected. The next implementation step is a true multi-layer core block:
preserve the internal order/relative offsets of the cone while allocating the DFF centre aperture around
the block, then reserve its boundary channels before routing. Until that browser result resembles ELK's
central waist, SBP-03 and the round remain in progress.

## 3. Work packages

### SBP-01 — Visual oracle and measurable structure

- Export deterministic Simple/ELK geometry and screenshots for the exact acceptance query.
- Add diagnostics for root spine, branch membership, branch bounds, mirrored-pair center error, whitespace
  distribution, trunk count, turn-direction consistency, crossings and outer routes.
- Record the right-side DFF identities from topology only for analysis; tests must assert structural metrics,
  not hard-code those identities into the algorithm.

Exit gate: the report explains which ELK branch group each visible DFF belongs to and can distinguish an
ELK-like branch arrangement from a centered tight stack.

### SBP-02 — Multi-layer branch decomposition

- Build a layout-only branch forest from the focused roots and the reversible layered graph.
- Treat physical-net carriers as shared trunk structure; do not duplicate a branch for every logical edge.
- Assign each real node to a deterministic primary branch using dominator-like ownership / nearest common
  ancestor evidence, while retaining explicit shared-node and cross-branch edges.
- Form branch blocks spanning multiple layers and derive stable sibling order from existing topology order.

Bounds: near-linear graph traversal plus per-layer stable sorting; no all-pairs node comparison.

Exit gate: permutation tests produce identical branch IDs/order, and the `_1471_` diagnostic identifies
coherent DFF/data-logic branch blocks rather than one global DFF column.

### SBP-03 — Symmetric block placement with slack allocation

- Place the root block on a stable horizontal spine.
- Recursively place sibling blocks above and below the spine using subtree height, port offsets and routing
  demand; distribute available whitespace between branch blocks instead of forcing minimum-gap packing.
- Solve intra-block alignment and inter-block separation as different constraints. Preserve node order and
  non-overlap as hard constraints; symmetry and straight pin alignment are scored preferences.
- Generate bounded top-down/bottom-up and left/right alignment variants, but compare candidates using branch
  metrics before invoking the full router.

Exit gate: the selected Simple candidate no longer renders the right-side DFFs as one minimum-gap stack,
mirrored branch-center error improves materially toward ELK, and bounds remain usable.

### SBP-04 — Branch-aware regular routing

- Reserve one horizontal spine/trunk and bounded vertical channels per branch boundary before edge routing.
- Route shared physical nets atomically; branch taps follow a consistent horizontal–vertical–horizontal
  convention, with stable lane order under input permutations.
- Penalize bends that reverse horizontal progress, inconsistent sibling turn direction, crossings through a
  sibling block, and routine outer-lane use.
- Keep orthogonality, pin side, node avoidance and foreign-net collinear overlap in the shared validator.

Exit gate: zero missing/unroutable routes and zero hard violations; horizontal-first and horizontal-endpoint
ratios remain 1.0; repeated sibling branches have consistent bend orientation; outer use does not regress.

### SBP-05 — Candidate scoring and stop conditions

- Replace the current port-delta-dominated comparison with a named lexicographic gate:
  hard validity -> branch integrity -> visual symmetry/whitespace -> routing regularity -> crossings/length ->
  bounds. Record every component.
- Do not let a visually failed tight-stack candidate win solely because its total port delta is smaller.
- Retain legacy/balanced fallback for unrelated graphs, but fallback is not acceptance for `_1471_`.

Stop and redesign if the only way to select the new candidate is fixture-specific weighting, unbounded route
search, relaxed validation, or materially worse topology determinism.

### SBP-06 — Verification and delivery

Run, in order:

1. Branch decomposition, symmetry, whitespace, routing-direction and permutation unit tests.
2. Exact `_1471_` 3/3 and `clk` 1/1 focused fixture tests.
3. Layout determinism and fixture invariants, then full `npm test`.
4. `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases` on Linux.
5. `npm run benchmark` on Linux; Whole remains a single bounded path unless evidence supports activation.
6. Browser side-by-side Simple/ELK review at identical query and viewport.

Only after all gates pass: commit task-owned paths on `dev`, push `dev`, fast-forward/merge to `master`, and
push `master`. Preserve user-owned workspace files.

## 4. Quantitative gates

- `_1471_` Simple: 0 missing routes, 0 hard violations, 0 foreign-net overlaps.
- Bent routes: horizontal-first = 100%, horizontal endpoint entry = 100%.
- The selected candidate must beat the current balanced baseline in branch-center symmetry and whitespace
  distribution; those metrics will be frozen numerically by SBP-01 before implementation.
- Canvas width must remain <= 6,600. Height may grow only when the added space is demonstrably structured
  inter-branch whitespace; it must remain below the current ELK reference height of 32,160.5.
- No regression from the accepted `clk` 1/1 result: 0 missing, 0 violations, and no loss of its established
  horizontal trunk behavior.
- Whole 8,192-cell layout median must not regress by more than 10% from the recorded 5,355.9 ms reference,
  and no graph-size-dependent retry budget may be introduced.
- Mapped failures and violation classes may not exceed the recorded baseline; new failure categories block
  delivery.

## 5. Completion rule

This document stays planned/in-progress until both machine gates and the browser visual gate pass. In
particular, successful unit tests, compact bounds, or safe fallback do not close the round while `_1471_`
still lacks ELK-like orderly symmetric branches and regular nets.
