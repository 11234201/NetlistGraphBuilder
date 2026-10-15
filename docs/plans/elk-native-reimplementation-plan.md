# ELK-native clean reimplementation plan

Date: 2026-09-25  
Status: G0-G3 entry gates closed; ER-04 through ER-09 implemented and reference-tested; ER-10 full-corpus and visual acceptance in progress. No provider cutover.  
Evidence: [`elk-layered-source-audit-2026-09-24.md`](../research/elk-layered-source-audit-2026-09-24.md)

## Objective

Replace the current Native P1-P5 implementation with a source-grounded ELK Layered equivalent adapted to
this repository's deterministic, offline JavaScript runtime. The target is comparable structural readability,
not coordinate identity. The effort is a clean internal replacement, not a sequence of spacing patches.

## Non-negotiable rules

- No fixture name, instance name, coordinate, depth-specific or `groupGap` rule in production algorithms.
- No phase may consume information that ELK only produces in a later phase.
- Every phase has an immutable input/output contract and a phase-local oracle before provider integration.
- Old and new P1-P5 implementations do not call each other. The new pipeline lives under
  `src/layout/elk_native/` until one atomic provider cutover.
- Simple Layered remains the product default. Native remains Experimental until the final visual gate.
- Performance optimization remains paused; asymptotic guards and bounded iteration contracts are still required.
- A green hard validator is necessary but cannot satisfy a visual gate.

## Runtime and package decision

- The first accepted implementation remains browser-native JavaScript. This matches the repository's offline,
  no-bundler ES-module runtime and keeps every P1-P5 state directly observable by the differential harness.
- The algorithm is delivered as a self-contained, versioned static module package with one stable public entry,
  no install-time dependency resolution, a versioned IR/snapshot protocol, test vectors and provenance metadata.
  A fresh clone can import it directly, in the same operational sense that the checked-in elkjs package is usable.
- C++ is not a prerequisite and is not part of ER-04 through ER-13. A native static library cannot run in the browser
  without a process or WebAssembly bridge, which would add ABI, memory, cancellation, diagnostics and release work
  before algorithm parity is known.
- After correctness and visual acceptance, a benchmark may justify porting a pure compute kernel to C++/WebAssembly.
  Such a port must implement the same versioned protocol and reproduce the JavaScript reference snapshots; UI,
  adapters and phase contracts do not move with it. Performance remains paused until the user reopens it.

## Disposition of current Native code

| Current module | Decision | Reason |
| --- | --- | --- |
| `canonical_graph.js` | retain behind adapter | Stable identities and physical-net grouping remain valid |
| `cycle_breaking.js` | replace, then delete | Must match audited greedy source/sink/max-outflow semantics with stable ties |
| `rank_assignment.js` | replace, then delete | Local longest-path refinement is not network simplex |
| `proper_layering.js` | replace/port into new IR | Long-edge splitting belongs before P3 and must create typed dummies/ports |
| `crossing_minimization.js` | replace, then delete | Missing port ranks, constraints, best attempts and ELK sweep semantics |
| `hyperedge_dummy_merging.js` | reimplement on new IR | Scheduling is correct but P4 needs complete neighbour/port semantics |
| `block_placement.js` | replace, then delete | Not semantically equivalent to BK |
| `structure_packing.js` | delete at cutover | Focused ownership/group gaps are not ELK placement semantics |
| `router/` | replace by default, then delete | Prior work targeted hard correctness; complete ELK P5 visual semantics have not been proven equivalent |
| shared validator/render/provider boundary | retain | These are downstream contracts, not placement policy |

## Work packages

| ID | Work | Output | Exit gate | Status |
| --- | --- | --- | --- | --- |
| ER-00 | Freeze rejected baseline | sop015/eq012 ELK and Native SVGs, phase metrics, current code inventory | Commands reproduce the 12/7 columns and 28/228 crossing gap | completed |
| ER-01 | Processor/source map | Verified P1-P5 schedule, intermediate processors and defaults at pinned commit | Every planned phase cites concrete ELK classes and scheduling | completed |
| ER-02 | P2 source closure | Network-simplex data model, feasible-tree/pivot/tie/balancing specification | Source contract includes first-minimum ties, subtree peeling and balancing | completed |
| ER-03 | P1/P3/P4 source closure | Greedy cycle breaking, dual port distributors, constraints, conflict marking, spacing and BK class graph | No unresolved semantic question remains for the scoped flat schematic pipeline | completed |
| ER-03R | P5 routing source closure | Hyperedge construction through long-edge restoration, including visual ordering and x projection | Every P5 data structure, phase and tie rule is mapped; no current-router reuse assumption remains | completed |
| ER-04 | New layered IR and P1 | `elk_native` nodes/ports/margins plus audited greedy cycle orientation | Immutable permutation-stable round trip and feedback set; no provider integration | completed |
| ER-05 | Network-simplex layering | Deterministic feasible-tree optimizer and component balancing | Phase oracle passes; sop015 rank/column profile is structurally close to ELK | complete under source-audited bounded feasible-rank contract 1.1; non-optimal budget termination is explicit |
| ER-06 | Proper graph and ports | Long-edge split, fixed-side port order model, hyperedge dummy preparation | Every inter-layer P3 edge is adjacent-layer; explicit inverted-port same-layer helpers; join lineage is lossless | completed |
| ER-07 | Layer-sweep ordering | Port-rank barycentres, constraints, forward/back sweeps and best snapshots | Crossing count never worsens; synthetic and sop015 order oracles pass | completed |
| ER-08 | Full BK placement | Conflict marking, four alignments, inner shifts, class-graph compaction and candidate selection | BK paper/source hand cases pass; no post-placement tree/group pass exists | completed |
| ER-09A | Exact P5 oracle | Exhaustive segment-pair dependencies, ELK thresholds/costs, cycle/split/slot rules | Bounded hand/exhaustive cases match pinned ELK semantics | complete: pair, 4096 feedback graphs, nine opposed critical pairs and 192 bounded seeded split inputs |
| ER-09B | Scalable dependency discovery | Replace pair enumeration only with a proved-exact spatial/sweep index | Same dependency multiset as ER-09A; no truncation or retry budget | completed; recorded boundaries plus 160 differential inputs |
| ER-09C | Cycle and split plan | Deterministic critical split and non-critical feedback handling | Same optimality tuple as oracle; no unresolved critical cycle | complete: pinned probe plus independent free-area scoring/reference reconstruction; unresolved critical cycles reject |
| ER-09D | Slots and boundary projection | Topological numbering, rightward compaction and slot-derived x widths | Slot and layer-x oracles pass under permutations | completed; six pinned P4-to-P5 geometry oracles |
| ER-09E | Geometry and restoration | Bends, junctions, exceptional ports/self-loops and long-edge join-back | Geometry oracle and shared hard validator pass | completed in scoped W/E geometry; three additional pinned self-loop probes |
| ER-10 | Vertical-slice acceptance | Run exact sop015 and eq012 comparisons before cutover | All visual and correctness gates below pass | Focused numerical/topology and developer viewport checks pass; frozen full run 46/47, dp020 times out at unchanged 45 seconds; no cutover |
| ER-11 | Atomic cutover and deletion | Switch `native-layered` once; delete all superseded P2-P5 and patch-era tests | Architecture test proves no old modules/fallback remain | planned |
| ER-12 | Corpus verification | Unit, determinism, fixtures and mapped correctness | Required suites green; performance measurements recorded but not optimized | planned |
| ER-13 | Browser decision | Same-source, same-query, same-viewport ELK versus Native review | User-visible layout and wiring are comparable; otherwise Native stays Experimental | planned |

## Mandatory development process

The work packages above describe algorithms. They are not sufficient by themselves. The following gates prevent
another implementation from becoming a large unverified approximation.

### Gate G0 — scope, provenance and licensing

Before implementation:

- freeze the supported product scope: flat, left-to-right module canvas; west/east cell ports; external boundary
  ports; hyperedges; reversed edges; self-loops; no compound-in-one-canvas layout or wrapping;
- record the upstream commit, every source class consulted, and EPL-2.0 provenance;
- decide and document whether the implementation is a behavioral rewrite or contains translated/copied source.
  Copied or closely translated source must not enter the repository until its licensing consequences and notices are
  reviewed. The default plan is a behavioral rewrite with source citations and independently structured code;
- correct scope language everywhere before code starts. A P1-P5 rewrite may not be implemented under a P2-P4 ticket.

Output: a completed provenance section in the source audit and a checked plan vocabulary audit.

### Gate G1 — executable upstream phase oracle

Do not treat prose or final elkjs coordinates as a phase oracle. Build a research-only harness against the pinned
ELK Java source under `/home/wzh/open_source/`; it must export normalized JSON snapshots after:

1. imported graph and fixed port geometry;
2. P1 orientation;
3. P2 ranks and objective;
4. long-edge splitting;
5. every retained P3 node+port order candidate and crossing count;
6. hyperedge dummy merging;
7. all four P4 BK candidates, conflicts, blocks, inner shifts, class constraints and selected candidate;
8. every P5 boundary's segments, dependencies, feedback decisions, splits, slots and width;
9. final bends, junctions and restored logical edges.

Snapshots use canonical fixture IDs rather than ELK allocation IDs and include the complete option set and seed.
The harness is third-party research infrastructure, not production runtime. If a phase cannot be observed reliably,
that phase remains blocked; handwritten expected values are not a substitute.

Output: `docs/experiments/elk-phase-oracle.md`, harness path/commit, schema version and reproducible commands.

### Gate G2 — stratified corpus, not two showcase fixtures

Before ER-04, define a compact corpus covering:

- chain, diamond, balanced/unbalanced trees and reconvergent DAGs;
- long edges, multi-port cells, fanout hyperedges and shared physical nets;
- cycles, self-loops, external input/output ports and disconnected components;
- unequal node heights/margins and dense same-y port conflicts;
- sop015 `_5426_`, eq012 `_1471_` and `clk`;
- a deterministic stratified sample from the mapped corpus by size and topology features.

Every case declares which P1-P5 mechanism it exercises. Adding a production special case for one corpus member is
an automatic rejection.

Output: `docs/experiments/elk-parity-corpus.md` and a machine-readable manifest.

### Gate G3 — contracts before algorithms

Freeze versioned schemas for phase inputs/outputs before ER-04 implementation. Each schema states:

- immutable fields and ownership;
- canonical/stable ordering;
- invariants and allowed diagnostics;
- lineage required for restoration;
- exact fields included in differential snapshots;
- memory/cancellation boundaries.

Review the complete P1→P5 data flow as one document. A later phase must not recover missing information by reading
the source graph privately or by inferring it from coordinates.

Output: `docs/design/elk-native-phase-contracts.md`.

### Gate G4 — exact reference first, optimized implementation second

For Network Simplex, crossing counting, BK constraints and P5 dependencies:

- implement a deliberately simple, bounded reference version used only by tests;
- differential-test the production implementation against it on exhaustive small graphs and randomized
  deterministic graphs;
- optimization may change data structures but not normalized phase output or objective/cost tuple;
- truncation, unresolved-cycle diagnostics and approximate fallbacks are forbidden in accepted output.

No scalable implementation is reviewed before the reference oracle is green.

### Gate G5 — one phase per review unit

Each ER package is a separate review unit with:

- one primary algorithmic hypothesis;
- source citations and contract changes;
- phase oracle diff;
- permutation/property tests;
- failure cases and complexity statement;
- no changes to later phases except typed adapters or test scaffolding.

Do not combine P2, P3 and P4 in one large change. Do not carry a failing phase forward to see whether a later phase
"makes the picture better".

### Gate G6 — structural code-quality controls

- The orchestrator only sequences phases and records metrics; it contains no algorithm body.
- IR, reference oracle, production algorithm, validation and serialization live in separate modules.
- Architecture tests forbid imports from old Native algorithms and forbid reverse imports from a later phase.
- Every phase exports a validator used both by tests and the next phase boundary.
- No generic `utils.js`, coordinate repair module, catch-all fallback, hidden feature flag or fixture policy module.
- Diagnostics identify the violated invariant and phase; they do not silently publish partial geometry.

### Gate G7 — differential acceptance at three levels

1. **Phase parity:** normalized P1-P5 snapshots versus the pinned ELK harness.
2. **Semantic correctness:** shared hard validator, logical-edge lineage, physical-net connectivity and permutation
   determinism.
3. **Visual quality:** fixed-query, fixed-viewport ELK/Native SVGs plus metrics for layers, order, crossings, physical
   crossings, line length, bends, straight trunks, bounds and whitespace.

A downstream visual improvement cannot waive a phase mismatch unless the plan records an intentional adaptation and
an ablation proves it is better across the stratified corpus.

### Gate G8 — visual review protocol

- Generate ELK and Native from the same source graph and display policy.
- Normalize viewport, scale, gate-symbol mode, labels and wire spacing.
- Review full view plus named local crops; never compare separately fitted screenshots.
- Record images/SVGs in ignored experiment output and commit the generation manifest, metrics and decision.
- User-visible acceptance is mandatory for ER-13. Numerical thresholds cannot overrule a rejected drawing.

### Gate G9 — atomic cutover, deletion and rollback

- Until ER-10 passes, `elk_native` is test-only and cannot appear as a second UI provider.
- Cutover changes the existing Experimental `native-layered` provider once; there is no runtime dual path.
- The same change deletes all superseded Native P1-P5 modules, patch-era thresholds and tests that assert obsolete
  internals. Durable scenario fixtures and provider-level acceptance tests remain.
- Architecture tests fail if deleted modules, imports, fallback flags or `groupGap`/Focused placement ownership return.
- If cutover validation fails, revert the cutover as a unit; do not reconnect individual old phases.

### Gate G10 — product integration after algorithm acceptance

Only after ER-10:

- verify cancellation/progress metrics through the existing job boundary;
- verify Single/Compare consume the same provider contract;
- verify Adjust overrides operate on the completed automatic graph without rerunning P1-P5 during drag;
- run progressive SVG, export, offline release and session restore checks;
- record performance and memory but do not optimize while the performance pause remains active.

These checks cannot be used to justify weakening algorithm parity.

## Entry criteria for implementation

ER-04 may start only when all are true:

- G0 provenance/scope is complete;
- G1 upstream phase harness has produced at least one complete P1-P5 snapshot;
- G2 corpus manifest exists and covers every scoped mechanism;
- G3 phase contracts are reviewed;
- exact baseline artifacts and generation commands are reproducible;
- no production code change from the rejected patch series is being treated as a foundation.

Until then, project status is **research/planning**, not implementation.

## Phase contracts and tests

### ER-04: ELK-native IR

Required records:

```text
LayerNode: stable key, type (normal/long-edge/external-port), size, margins, ports
LayerPort: stable key, side, order, local anchor, incident edge lineage
LayerEdge: stable key, source port, target port, min length, shortness priority, original direction
Layer: ordered node keys
```

Tests: graph permutation, escaped identifiers, high-fanout physical nets, reversed cycle edges, and complete
long-edge join lineage. Arrays may be reordered without changing stable keys or final phase results.

P1 runs the audited sink/source/max-outflow cycle breaker over this IR. Stable topology keys replace seeded random
ties; reversed edges retain original ports and direction for restoration only after P5.

### ER-05: network simplex

Implement from the pinned ELK/common source specification:

1. feasible ranks satisfying every minimum length;
2. feasible tight-edge spanning tree per component;
3. cut values and deterministic negative-cut pivot selection;
4. leave-edge/enter-edge exchange with stable topology-key ties;
5. weighted-span objective and bounded iteration count;
6. balancing and multi-component layer-profile handling.

Do not ship a longest-path fallback inside this phase. Failure returns a deterministic diagnostic and stops
the experimental provider.

Oracles: chains, diamonds, weighted competing paths, disconnected components, fanout/fanin trees, and a
small exhaustive DAG set compared against vendored ELK rank spans after translation/normalization.

### ER-06/07: proper graph, ports and ordering

- Split every long edge before ordering and represent its intermediate ports explicitly.
- Select the ELK port distributor appropriate to fixed west/east ports; document the choice in ER-03.
- Calculate barycentres from port ranks, interpolate unknown preordered positions, resolve ordering constraints,
  and evaluate complete forward/backward sweep attempts.
- Replace ELK's incidental PRNG dependence with topology-seeded deterministic perturbations. The same graph
  permutation must generate the same attempt sequence.
- Retain the best complete node+port order; stop a run when a full sweep no longer improves crossings.

Oracles compare node order, port order and crossing count, not only a scalar final count.

### ER-08: full BK

Implement these source-visible structures directly:

- `NeighborhoodInformation` equivalent with ordered `(neighbour, edge, port)` records;
- type-1/type-2 conflict set over inner and non-inner segments;
- four layouts with `root`, `align`, `innerShift`, `blockSize`, `sink`, `shift`, and final `y`;
- port-anchor `insideBlockShift` including node margins;
- block placement plus class constraint graph and longest-path class shifts;
- straightening threshold strategy;
- candidate feasibility checking and default minimum-height selection under orthogonal routing.

Forbidden in or after this phase: `CenterRecursiveTrees`, Focused ownership, subtree `groupGap`, fixture
goldens used as coordinates, or a general overlap pass that changes a feasible BK result.

### ER-09: full orthogonal routing

This stage is not an adapter around the current Native router. It will implement the complete contract defined
by ER-03R: boundary-by-boundary hyperedge segments, dependency construction, cycle resolution and splitting,
slot assignment, routing-width calculation, west-to-east bend generation, junction creation, layer x projection,
and long-edge join-back. It must not change rank, layer order, y coordinates or port anchors.

Implementation order is mandatory:

1. ER-09A builds a deliberately simple exact oracle matching ELK's every-pair predicates and seeded phase order.
2. ER-09B introduces indexing only after differential tests exist; it must preserve the exact dependency multiset.
3. ER-09C implements critical-cycle splitting before non-critical feedback reversal/removal, including free-area
   scoring by crossings, dependencies and size.
4. ER-09D owns topological slots, rightward-only target compaction and slot-derived boundary/layer x coordinates.
5. ER-09E alone materializes bends and junctions, then joins dummy chains and restores semantic direction.

The complete current `src/layout/native_layered/router/` remains frozen evidence during these stages and is deleted
at ER-11. Copying individual functions from it into the new implementation before an oracle proves equivalence is
forbidden.

## Acceptance gates

### Phase-local hard gates

- exact rank feasibility and weighted span objective on P2 oracles;
- long-edge lineage round trip;
- P3 node and port order invariant under input permutations;
- all four BK candidates expose diagnostics; selected candidate is feasible;
- no node overlap, wrong layer order, or lost physical-net branch.

### Visual/quality gates

Exact comparisons use the same source/query and vendored ELK run. They are ratios, not copied coordinates.

For sop015 `_5426_` depth 3/3:

- visual column count at least 10 unless a lower count has no worse crossings and line length;
- crossings no more than `1.5 * ELK + 10` (current threshold: 52, current Native: 228);
- physical crossings no more than `1.5 * ELK + 10` (current threshold: 52, current Native: 187);
- total routed length no more than `1.5 * ELK` (current threshold: 27,982, current Native: 41,274);
- the `_5404_` subtrees are visually distinct in a same-viewport review; no single-gap assertion can replace it.

For eq012 `_1471_` and `clk`:

- retain zero missing/disconnected/hard violations;
- branch blocks and shared trunks pass the existing topology checks;
- retain four immediate branches and two shared membership groups for `_1471_`; physical nets remain trees,
  with no cycles, disconnected forests or fallback routes;
- measure visual membership fragmentation against same-run ELK, not a zero-fragment requirement that ELK
  itself fails. This is a soft layout preference and does not waive any geometry/connectivity rule;
- width/area and crossing ratios are compared to same-run ELK, not historical hand-tuned constants alone.

### Repository gates

```text
node --test <phase-focused tests>
node --test tests/unit/layout-determinism.test.js tests/unit/layout-fixtures.test.js
npm test
MAPPED_CASE_PROVIDER=native-layered MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases
```

Benchmarks are recorded only after visual/correctness acceptance and are not optimized while the user's
performance pause remains in force.

## Stop and rollback rules

- If ER-05 cannot match small ELK rank oracles, do not start P3.
- If P3 scalar crossings improve but port/node order or sop015 structure regresses, reject the implementation.
- If BK needs a post-placement tree/group pass, its data model or upstream order is incomplete; return to ER-06/07.
- If routing needs to move P4 nodes, the P4/P5 contract is wrong; do not hide it in geometry repair.
- If ER-10 fails any visual gate, do not cut over and do not keep tuning constants. Preserve the failed
  experiment in the work log and revise the corresponding source contract.

## Immediate next actions

当前入口改为 [ELK 水平验收与后续开发计划](elk_level_acceptance_plan.md)：

1. ELK-Q01 冻结质量基线、逐场景证据状态和验收口径。
2. ELK-Q02 扩大同视口视觉覆盖，ELK-Q03 定位首个可解释分歧；确认偏差后才做质量修复。
3. 性能继续暂停，dp020 失败保留；全部门禁闭合前不切换 provider、不删除旧实现、不发布。

The 2026-10-11 frozen run completed 46/47, with dp020 timing out; its independent original worker retry also
timed out. The user explicitly declined a narrowly scoped performance exception and chose to retain the failed
state. Therefore timeout optimization, provider cutover, old-code deletion and release remain pending. Other
performance work also remains paused. Reopening this work requires user direction, not a higher timeout.

## Contract review — 2026-10-11

The user's repeated instruction to use ELK as the standard is applied to two source-contract discrepancies.
This is an implementation interpretation of that instruction, not a claim that the user explicitly answered
the two-choice question from the previous turn.

- Upstream `NetworkSimplex.java` stops at `iterationLimit` and retains feasible ranks. Contract 1.1 adopts
  the unchanged bounded loop, publishes `optimal`, termination and negative-cut diagnostics, and emits
  a provider warning when optimality is uncertified. Final routing must still pass all hard validators.
- Focused ownership contiguity is not an ELK BK invariant. The former zero-fragment EQ assertion rejects
  ELK itself (13). The fresh candidate has 12; the replacement gate compares the same-run reference and
  separately preserves branch/shared membership and physical-net topology. No tree-packing pass is added.
- Critical-split reference evidence enumerates every candidate free area independently for nine opposed
  critical pairs plus 192 bounded seeded inputs; this is not exhaustive coverage of all possible graphs.
