# Simple layout freeze baseline

Date: 2026-09-20. Status: frozen. Branch: `dev`.

## Purpose

This document closes the current Simple layout improvement line and establishes the immutable comparison
baseline for the independent `native-layered` provider. The implementation baseline is commit
`b75068d` (`feat(layout): center focused fanin subtrees`); the independent provider architecture and plan
begin at planning commit `0a0a3a4`.

Completed Simple checkpoints through the baseline include:

- focused branch-bank and focused-core centring;
- focused fanin membership decomposition;
- contiguous exclusive/shared tree blocks;
- carrier target approaches around localized boundary leaves;
- recursive focused-fanin hierarchy modelling;
- bounded 32-pixel recursive subtree centring;
- deterministic node/edge permutation coverage.

These improvements remain supported behavior, but no new ELK-parity placement or routing phase is to be
added to Simple. Further layered-layout work belongs to `src/layout/native_layered/` and the plan in
[`native_layered_development.md`](native_layered_development.md).

## Frozen acceptance evidence

Commands were run from `dev` on 2026-09-20 using the checked-in eq012 fixture.

| Scenario | Nodes | Edges | Width | Height | Missing | Hard violations | Physical crossings | Bends | Outer routes | Unique wire length |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| focused net `clk`, depth 1/1 | 1,540 | 2,050 | 1,295 | 88,344 | 0 | 0 | 512 | 3,076 | 0 | 780,160 |
| focused cell `_1471_`, depth 3/3 | 787 | 1,085 | 5,938 | 28,646 | 0 | 0 | 1,260 | 4,661 | 1 | 453,383.5 |

`npm test` result: 630 tests passed, 0 failed.

Elapsed time is intentionally excluded from the frozen golden because host load varies. Native Layered comparisons
must record elapsed time and memory separately on the same host/run while treating geometry and validation
metrics above as the Simple reference.

## Freeze boundary

The following modules are frozen for Native Layered development:

- `src/layout/simpleLayered.js`;
- `src/layout/simplePlacementPipeline.js`;
- `src/layout/simpleLayering.js`;
- `src/layout/simpleRoutingPlan.js`;
- `src/layout/simpleOrthogonalRouter.js`;
- `src/layout/simpleRouteCandidates.js`;
- Simple-only placement modules under `src/layout/layered/`.

The freeze means:

- Native Layered stages must not be inserted into these files behind feature flags.
- Native Layered must not import these modules or treat their intermediate objects as contracts.
- Simple defaults and normalized policy values remain unchanged.
- New Native Layered tests must run without rewriting Simple golden expectations.
- Comparison tooling may read Simple output, but must not influence its input policy or execution path.

Shared correctness, security or compatibility defects may still be fixed when they affect existing product
behavior. Such a change requires a focused regression test, an explicit explanation that it is not Native Layered
implementation, and refreshed freeze evidence if any metric above changes. The freeze is not permission to
leave a newly discovered hard correctness bug unfixed.

## Shared boundaries available to Native Layered

Native Layered may consume stable shared contracts without inheriting Simple algorithms:

- layout-provider registration and `PositionedGraph` output contract;
- node measurement and connection-point geometry;
- canonical physical-net keys;
- shared orthogonal predicates and layout validator;
- spatial and route-segment indexes;
- wire-route normalization, label placement and renderer;
- workspace cache, cancellation, progress and manual-override boundaries.

Any shared boundary extension must remain provider-neutral and include tests proving existing Simple and ELK
behavior is unchanged.

## Reproduction commands

```text
npm test
node tools/compare_eq012_layouts.mjs --focus-net=clk --fanin-depth=1 --fanout-depth=1 --compact
node tools/compare_eq012_layouts.mjs --focus-cell=_1471_ --fanin-depth=3 --fanout-depth=3 --compact
```

Heavy Whole/mapped and benchmark evidence remains governed by `AGENTS.md` and runs on `mfs-remote` when
needed. The Simple freeze itself does not redefine existing Whole known issues or their budgets.

## Handoff to Native Layered

The next implementation task is NLD-01: create only the canonical provider-private graph model and its
permutation tests under `src/layout/native_layered/`. Provider registration follows after the model can handle
empty, disconnected, fanout and cyclic synthetic graphs. No Simple file should change in that task.
