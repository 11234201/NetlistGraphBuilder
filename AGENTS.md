# Project development constraints

Read this file before changing the repository. For netlist, layout, rendering, or canvas work,
also read `docs/skills/netlist-schematic/SKILL.md` and the documents it routes to.

## Repository contract

- Keep the runtime offline and dependency-light. Browser code is native ES modules served directly;
  do not assume a bundler or package installation step. ELK is vendored under `vendor/`.
- Preserve the data-flow boundary:
  `parser -> netlist IR -> inference/analysis -> layout -> render -> UI`.
- Keep parser output structural. Cell/pin inference, alias normalization, display transforms, layout,
  and UI state do not belong in the parser.
- Treat Netlist IR and automatic provider output as source data. Cone, hub, collapse, timing, and
  manual-layout operations produce derived graphs or explicit overrides; they must not silently mutate
  their inputs.
- Keep Single and Compare behavior on shared helpers/workspace boundaries. Do not fix one canvas by
  copying graph preparation, viewport, pointer, or override logic into another handler.
- Preserve canonical identifiers and display names separately, including escaped and hierarchical names.
  Escape user/netlist-controlled text before inserting it into HTML or SVG.

## Layout and performance invariants

- Layout and routing results must not depend on parser statement order or raw node/edge array order.
  Use stable topology keys and add permutation tests when changing ordering behavior.
- Route search must stay bounded. Do not add graph-size-proportional retry loops, all-pairs scans, or
  edge-count cliffs. Shared spatial indexes narrow candidates; geometry validation remains authoritative.
- Put hard routing rules in the shared orthogonal-routing/validation boundary. Put preferences in named
  candidate and scoring policies. Never repair a fixture with instance-name or coordinate special cases.
- Normalize layout policy, node overrides, and route limits at their owning boundaries. Algorithms must
  not introduce private coercion ranges or magic costs.
- Pointer and wheel hot paths may update lightweight preview DOM and transforms only. Coalesce high-rate
  events per animation frame; do not run a layout provider, rebuild the graph, render the full SVG, or
  persist session state on every move. Commit expensive rerouting/rendering once after the gesture.
- Large renders must remain progressive and cancellable. Decorative bridges may be omitted only during
  transient previews; the completed render restores full geometry, labels, and hit areas.

## Verification and fixture policy

- Run `npm test` for normal changes. Add a focused unit test at the boundary that owns the behavior.
- For layout/routing changes, run determinism and fixture invariant tests as well as the focused test.
- For parser, inference, graph, layout, or renderer changes that can affect synthesized designs, run
  `npm run test:mapped-cases`. Use `MAPPED_CASE_NO_COLLAPSE=1` for full-node regressions.
- Use `npm run benchmark` when changing complexity-sensitive graph, layout, routing, or rendering code.
  Treat benchmark changes as evidence, not as a replacement for correctness tests.
- Checked-in mapped fixtures live under `tests/fixtures/mapped/`. Commit only mapped Verilog and its
  durable test harness; keep synthesis logs, reports, JSON, and scratch output in ignored `dc_runs/`.
- The Windows release must remain a self-contained offline package. If release inputs change, run
  `npm run release:windows` and preserve the vendored ELK license in the artifact.

## Change hygiene

- Inspect `git status` before editing and before staging. Existing unrelated changes are user-owned.
- Stage explicit paths. Do not include plans, generated outputs, `dc_runs/`, or release artifacts unless
  the task explicitly changes them.
- Update architecture or design documents only when their contract changes. Keep roadmap detail in the
  appropriate stage plan instead of duplicating it in this file.
