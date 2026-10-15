# ELK-like focused tree-block layout plan

Updated: 2026-09-20. Status: frozen; superseded by
[`native_layered_development.md`](native_layered_development.md). Development branch: `dev`.

No further tree-block stages from this plan are to be added to Simple. Completed checkpoints remain
historical evidence for the Native Layered acceptance baseline.

## Acceptance target

For `eq_012`, Focused on `cell:_1471_`, fanin/fanout depth 3, the input and output
cones must read as several separate trees around the focused cell. Exclusive parts of
each tree remain contiguous and ordered; a node shared by several trees appears once in
an explicit common region connected back to those trees. A centred but interleaved layer
does not pass.

The implementation is topology-driven. It may not inspect fixture, instance, or net
names, and its result must be invariant under node/edge input permutations.

## Work packages

| ID | Work | Exit gate | Status |
| --- | --- | --- | --- |
| TBP-01 | Tree-membership oracle | Report immediate branches, exclusive/shared membership, per-layer fragmentation and interleaving for Simple and ELK | completed |
| TBP-02 | Deterministic decomposition | Propagate immediate-root branch membership through the visible DAG; represent shared nodes once with a stable membership set | completed |
| TBP-03 | Block placement | Place exclusive tree blocks contiguously and symmetrically; put shared membership blocks between participating trees; preserve non-overlap | in progress |
| TBP-04 | Tree corridors | Reserve consistent exit/entry channels per tree and common block without unbounded route search | pending |
| TBP-05 | Strict verification | Synthetic overlapping-tree tests, permutation tests, `_1471_` and `clk`, full tests, mapped cases, benchmark, same-viewport browser review | pending |

## Placement contract

1. Immediate predecessors/successors of the focused cell define the visible tree roots.
2. Reverse/forward propagation assigns each visible node a sorted branch-membership set.
   Membership size one is an exclusive tree; size greater than one is shared structure.
3. Nodes with equal membership form multi-layer blocks. Exclusive blocks cannot be
   interleaved in a layer. Shared blocks are not copied into an arbitrary owner tree.
4. Stable topology keys determine sibling order. Tree height and routing demand determine
   balanced whitespace around the focused spine.
5. Hard geometry remains in the shared validator. Tree separation and symmetry are named
   placement preferences, with bounded candidates and deterministic fallback.

## 2026-09-18 checkpoint

The `_1471_` fanin cone contains four immediate trees, 107 exclusive nodes and eight
shared nodes in six stable membership groups. Before tree-block placement, Simple split
those groups into 59 per-layer intervals with 15 fragmented groups. The current candidate
uses 25 intervals with zero fragmented groups: every populated membership is contiguous
in every layer, and shared nodes remain single graph objects carrying all owners.

The exact graph remains 6,122 x 28,662 with zero missing routes and zero hard validation
violations. A stricter experiment that forced the same fixed vertical bands through every
layer made the outline more rigid but caused six missing/disconnected routes, so it was
rejected. TBP-03 remains in progress until tree bands and the shared clk/rst/data carrier
corridors are allocated together and a new side-by-side browser review passes.

The ELK comparison now reconstructs visual ranks from x coordinates for both providers,
instead of comparing Simple logical levels with ELK visual columns. On the exact cone,
Simple uses eleven visual ranks and ELK twelve, so rank count is not the primary gap. The
pre-corridor comparison exposed an ordering gap: Simple had 50,588 logical crossings
versus ELK's 31,878. After physical-net merging, unique physical geometry and tree-shape
metrics are authoritative because shared target approaches intentionally repeat in the
logical-edge view. The next placement step therefore evaluates bounded forward/backward
tree-local ordering candidates before considering selective micro-layers.

The first unconditional multi-sweep candidate was rejected because it disconnected one
physical net. Tree-local ordering remains a bounded candidate problem rather than an
automatic overwrite. The accepted checkpoint instead assigns tree ordering before input
locality and adds a general carrier target-approach segment for localized boundary leaves.
All three large physical carriers are valid again, outer routes fall from 130 to one, and
the exact layout remains at zero missing routes and zero hard violations. A normalized
512-pixel focused-tree group gap makes the four exclusive/shared regions visible without
increasing the 28,646-pixel canvas height; physical crossings fall to 1,269.

Recursive decomposition now exposes the internal acceptance structure instead of treating
each first-level branch as a flat list. The four exclusive trees contain 14/35/28/30 nodes,
5/20/15/16 leaves, and maximum depths 3/3/3/4. Two explicit shared bridges contain four
nodes each: one joins branches 3-4, and one joins branches 1, 3 and 4. These arborescences
are the input to the next subtree-height and parent-centering placement candidate.

The first unconstrained recursive-height candidate was rejected because it expanded
children freely and regressed physical crossings and wire length. The replacement projects
parent-centering preferences into the existing stable per-layer order with a bounded shift.
A second parameter scan after final-visual-column order enforcement selected a 32-pixel
bound: on `_1471_` it keeps zero missing routes and zero hard violations, reduces physical
crossings from 1,269 to 1,260 and unique wire length from 454,527 to 453,383.5, without
changing the 5,938 x 28,646 canvas. Larger 80-160 pixel shifts were rejected because they
made two to four routes infeasible. Visual comparison also confirms that shared leaves
remain shared while the four exclusive roots read as separate parent-centred trees. The
bounded placement is therefore enabled by default.
`--recursive-tree-max-shift` remains available in the comparison tool for reproducible
parameter studies.

## Quantitative and visual gates

- `_1471_`: zero missing routes and zero hard routing violations; width <= 6,600 and
  height below the recorded ELK reference of 32,160.5.
- Every exclusive membership set occupies at most one interval per populated layer.
- Cross-tree alternations decrease materially from the frozen TBP-01 baseline.
- A shared leaf is emitted once, reported with all owners, and placed in a recognizable
  common band between its participating exclusive trees.
- Input permutation produces identical membership IDs, sibling order, positions, and
  routes.
- Final acceptance is visual: the user must be able to distinguish the separate trees and
  their shared leaves at fit-to-view scale. Numerical centring alone is insufficient.

## Delivery

Commit only task-owned paths on `dev`. After all gates pass, push `dev`, merge into
`master`, and push `master`. Preserve unrelated workspace changes.
