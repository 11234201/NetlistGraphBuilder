# ELK-inspired Simple layout implementation roadmap

Status: superseded by `docs/plans/elk-parity-layered-pipeline.md` on 2026-09-15. Change sets A, B and C
below are implemented and measured; they do not resolve the `cell:_1471_` depth 3/3 scenario, so the work
moved from local change sets to a full proper-layering pipeline. This file is kept as the record of what
was measured and why it was not sufficient.

Date: 2026-09-15. Target branch: `dev`. Primary scenario: eq012 Focused net `clk`, depth 1/1.

## Design objective

Improve Simple's ordering, balance, and channel compactness by transferring the useful invariants of ELK
Layered while retaining the project's deterministic, offline, dependency-light implementation and bounded
orthogonal router. ELK geometry is a visual reference, not an exact coordinate oracle.

## Change set A — scored layer sweeps

Replace the fixed “keep the last of four rounds” behavior in `simpleLayering.js` with a bounded sequence of
stable forward/backward barycenter sweeps. Score the initial order and every completed directional sweep;
retain the lowest-crossing order, with a stable topology-key signature as the tie break.

- Bound: at most seven rounds, two directional sweeps per round.
- Score: group edges by layer pair and count target-rank inversions after sorting by source rank. Equal
  source or target ranks do not count as crossings.
- Complexity: `O(R * (V log V + E log E))` for fixed `R <= 7`; no edge-pair scan.
- Tests: a graph where the final sweep is worse than an earlier state; node/edge permutation equality;
  long-edge input ordering remains deterministic.
- Stop condition: reject the change if fixture crossing score increases, ordering depends on input array
  order, or runtime becomes graph-size-quadratic.

## Change set B — centered, bidirectional vertical compaction

Center each initial layer within the height of the tallest initial layer instead of resetting every layer to
the same top coordinate. Replace the ordinary one-sided overlap repair with an order-constrained least-
squares projection: transform minimum node gaps into monotonic coordinate constraints and use deterministic
pool-adjacent-violators compaction. This preserves preferred pin-aligned rows while allowing a layer to move
both upward and downward.

Primary-chain anchoring keeps its existing specialized path. Manual node positions remain the final explicit
override and are not inputs to automatic compaction.

- Bound: linear in nodes per layer after the existing sort.
- Tests: short layers center against tall layers; overlap repair may move the first node upward rather than
  pushing all later nodes down; variable heights and adaptive gaps remain valid; permutation test passes.
- Stop condition: reject or narrow the change if any layer order changes, nodes overlap, margin is violated,
  direct single-connection alignment regresses, or fixture height grows materially.

## Change set C — measured channel width

Remove raw logical fanout multiplication from the preliminary x step. Use `fanoutX` as the fixed minimum for
a high-fanout boundary, then let the existing physical-net interval allocator measure reusable lane demand
and expand only the affected layer suffix. This eliminates duplicate capacity reservation while preserving
the Wire spacing control through `requiredInterLayerGap()`.

- Bound: unchanged `O(D log D)` interval allocation and existing named lane caps.
- Tests: a large fanout does not create a gap proportional to logical edge count; increasing wire spacing
  still expands a genuinely multi-lane channel; routes remain valid.
- eq012 target: reduce width below the ELK 8,524-pixel reference if the shared-tree router permits it, with
  zero missing routes and zero hard validation violations. A smaller result is acceptable because Simple
  shares one physical-net trunk where the ELK adapter emits many logical edge sections.
- Stop condition: retain a larger structural minimum if compacting the gap causes hard validation failures;
  never compensate with unbounded candidate retries.

## Change set D — routing only on evidence

Do not rewrite the router preemptively. If A–C expose a concrete failure, fix it at the shared physical-net
capacity/candidate/validation boundary and add the smallest owning test. ELK's pairwise segment-dependency
construction is explicitly out of scope because it introduces an `O(m^2)` busy-channel cliff.

## Acceptance gates

1. Exact eq012 query: zero missing/unroutable edges and zero hard validation violations.
2. Visual: no common-top packing for unequal layers; coherent cell/output ordering; no oversized empty
   hub-to-cell channel.
3. Determinism: identical node coordinates and route geometry under node/edge permutations.
4. Correctness: focused layout/routing tests, fixture invariants, then full `npm test`.
5. Synthesized regressions: `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases` with failures investigated,
   not hidden by the legacy truthy-`routeKind` metric.
6. Complexity: `npm run benchmark`; record time and memory evidence. A constant-factor increase in the
   ordering phase is acceptable only if total layout remains practical and no size cliff appears.
7. Delivery: stage task-owned paths only, commit on `dev`, merge into `master`, and leave the pre-existing
   `.vscode/settings.json` modification untouched.
