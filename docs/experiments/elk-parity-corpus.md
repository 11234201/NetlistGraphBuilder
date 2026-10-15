# ELK-native parity corpus

Date: 2026-10-05  
Manifest: `tests/fixtures/elk_parity/manifest.json`  
Status: G2 corpus definition complete; execution belongs to later phase gates.

## Purpose

This corpus prevents the replacement pipeline from being judged by two attractive screenshots. It is ordered so a
failure is first localized on a small mechanism graph, then checked at the product Focused boundary, and only then
exercised on full mapped designs. Production code may not branch on any case ID, source path, cell name or query.

The manifest currently contains 18 cases and 54 named mechanisms. It is the authoritative case inventory. This document explains selection and acceptance; it does not
duplicate graph data or silently add cases.

## Tiers

| Tier | Role | Acceptance evidence |
| --- | --- | --- |
| synthetic | Isolate one or a few audited ELK mechanisms with complete P1-P5 snapshots | normalized phase diff, invariants, objective/cost tuple, permutation stability |
| focused | Exercise the real parser→IR→query→layout boundary on named user-visible regressions | phase diff where observable, shared hard validator, fixed-viewport visual metrics and SVG review |
| mapped | Detect integration, lineage and scale failures on full checked-in mapped netlists | full-graph correctness, determinism, diagnostics and recorded runtime/memory evidence without optimization |

`oracle_smoke_001` is the G1 bootstrap. It deliberately contains a directed cycle, fanout, reconvergence and a long
edge so one execution crosses all five main phases and the required intermediate processors. Passing it proves the
oracle mechanism works; it does not prove algorithm parity.

`p5_critical_split_001` is a direct upstream P5 mechanism probe, not a complete graph. It exercises opposing
critical dependencies, feedback selection and a segment split that the smoke graph does not trigger.

## Mechanism coverage

- P1: a directed cycle and a separate self-loop case distinguish greedy feedback orientation from self-loop
  preprocessing/restoration.
- P2: chains, diamonds, balanced and unbalanced branches, disconnected components and reconvergence exercise
  feasibility, weighted span, balancing and component-local ranking.
- P3: long-edge dummies, forward/backward sweeps, node constraints, fixed port order, both port-rank distributions
  and high-fanout order are independently represented.
- P4: median alignment, type-1 conflicts, four directional candidates, port-anchor inner shifts, class constraints,
  node-type spacing and unequal heights all have explicit cases.
- P5: straight segments, hyperedge construction, pairwise/critical dependencies, splitting, slots, boundary width,
  junctions and long-edge restoration are covered before large mapped runs.
- Product boundaries: external ports, physical-net lineage, disconnected components, full-node queries, Focused
  queries and permutation determinism are named rather than inferred from screenshots.

## Fixed mapped sample

The full-graph sample is intentionally fixed and reviewable:

- small: `sop_001_mapped.v` (1,012 bytes);
- medium: `eq_006_mapped.v` (12,300 bytes);
- large: `dp_002_mapped.v` (52,041 bytes).

The byte strata select stable checked-in inputs without making layout depend on parser order or on whatever files
happen to exist at test time. Changing the sample requires a manifest version change and a work-log entry.

## Execution order and stop rule

1. Validate the manifest and generate canonical graph IDs.
2. Run the pinned upstream phase oracle for the applicable synthetic cases.
3. Run the JavaScript reference phase and compare the first divergent normalized snapshot.
4. Only after synthetic parity, run the three Focused cases.
5. Only after Focused semantic and visual gates, run the mapped stratum.

Stop at the first phase mismatch. A later phase, a lower crossing total or a visually better final drawing cannot
mask an unexplained earlier difference. Intentional adaptations require a recorded reason, an ablation across the
whole relevant tier and a contract/schema version update when semantics change.

## Durable evidence

Committed evidence consists of the manifest, phase schemas, small normalized snapshots and deterministic metrics.
Large logs, Maven/Tycho artifacts, generated SVGs and scratch JSON stay on `mfs-remote` or in ignored experiment
output. Visual sign-off uses the same source graph, query, viewport, scale, labels, symbols and wire spacing.
