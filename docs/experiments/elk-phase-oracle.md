# Pinned ELK phase oracle: executable phase and decision evidence

Date: 2026-10-08  
Status: G1 smoke, chain, diamond, reconvergent-long-edge and P5 split probes verified; port-order and Focused oracles remain open.  
Upstream: `eclipse-elk/elk` commit `28e5173243cab0cf4e2c9816c803bc0d5c47ab24` (EPL-2.0).  
Source archive SHA-256: `f432e8f53006e96f178da9470ced34f551bbb278ffce52ea094a3fe54cb3420c`.

## Executed method

The research harness is in `tools/research/elk_phase_oracle/`. On `mfs-remote`, the pinned source is at
`/home/wzh/open_source/elk-layered-phase-oracle-pinned`. Java 17.0.15 and Maven 3.9.9 were used. The existing
`org.eclipse.elk.alg.layered.test` Tycho bundle receives a research-only Java test, manifest and build-properties
overlay. Its normal tests are excluded from this execution because their broad `org.eclipse.elk.alg.test` dependency
pulls in unrelated algorithms and native integrations.

`LayeredLayoutProvider.startLayoutTest()` imports the graph. `ElkLayered.getLayoutTestConfiguration()` supplies the
actual configured processor sequence. `ElkLayered.runLayoutTestStep()` executes one real processor per step. The
harness serializes each resulting `LGraph`, including layers, node and port orders, geometry, edge segments, reversal,
bends, junctions and logical/physical net lineage. It does not synthesize intermediate coordinates from final elkjs
output.

The exact command after the pinned source and toolchains are prepared is:

```sh
bash /home/wzh/my_code/elk-layered-phase-oracle/harness/run_oracle.sh
```

The runner uses `clean verify`; Tycho's JUnit execution is bound to `verify`, not `test`. The output is copied from
the test bundle's fixed `target/elk-phase-oracle/` path to the requested result path. First-time dependency downloads
and all build logs stay on the remote server. The full unmodified 58-module build reached the Layered bundle, then
stalled on an unrelated Libavoid binary download; the oracle executes against the installed pinned Core, Graph,
Common and Layered bundles without Libavoid.

## Result

`oracle_smoke_001` from `tests/fixtures/elk_parity/manifest.json` has six nodes and eight logical edges, including
a directed cycle, fanout, reconvergence and a long edge. The harness ran three JUnit tests with zero failures. Two
independent `clean verify` runs of the current harness produced byte-identical JSON:

- smoke graph, after correcting dummy lineage: `f62601effc367ca2843901168754c45600a947a73b33e255900ae514a5e3268a`;
- P5 conflict/split mechanism: `b4864abcc3040ed8fda6c2965737bec5332c0ad2b938e1b30bbdfe96dce6ccc1`.

The same harness now runs two additional explicit manifest graphs, with byte-identical results on two remote runs:
`chain_4` has 22 snapshots, P2 weighted span 3, five P5 boundaries and SHA-256
`446897e49f1588e283ed35e7fdbafa4036b17d4edc7f9b7543c9b17216a9df14`;
`diamond` has 22 snapshots, P2 weighted span 4, four P5 boundaries and SHA-256
`26ff3d6e96fb50f2e992603f255f3c075acff397092c527214634623d1aa8732`.
`reconvergent_long_edge` has 22 snapshots, P2 weighted span 9, five P5 boundaries and SHA-256
`c27c1cb72d7a33f1895dcf39ba68e732cc9c3928fb9a271be61ff0695ee525cd`. Two independent remote
runs were byte-identical. The split phase produced three long-edge dummies, including two sourced from direct
edge `e_ad`; restoration removed all of them.

The durable snapshot is `tests/fixtures/elk_parity/oracles/oracle_smoke_001.elk.json` (schema 1.1.0). It contains
23 snapshots. The observed milestone sequence is imported, P1, P2, long-edge split, P3, P3, hyperedge dummy merge,
P4, P5, restored, final. P3 appears twice because that is the actual processor schedule for these options. Node and
edge counts are 6/8 on import, 8/10 after long-edge splitting, 10/12 at P3 and P5, and 6/8 after restoration. The
final graph has three layers.

Run the dependency-free local checks with:

```sh
node tools/research/elk_phase_oracle/validate_artifacts.mjs
node tools/research/elk_phase_oracle/validate_oracle.mjs
node tools/research/elk_phase_oracle/validate_oracle.mjs tests/fixtures/elk_parity/oracles/chain_4.elk.json
node tools/research/elk_phase_oracle/validate_oracle.mjs tests/fixtures/elk_parity/oracles/diamond.elk.json
node tools/research/elk_phase_oracle/validate_oracle.mjs tests/fixtures/elk_parity/oracles/reconvergent_long_edge.elk.json
node tools/research/elk_phase_oracle/validate_p5_probe.mjs
```

The oracle validator checks schema 1.1.0 fields, manifest commit/fixture/options, milestone presence, counts,
unique identities, and node/port/edge references. The harness assigns persistent IDs to observed dummy objects and
edge segments rather than encoding their mutable layer/order into identity. Its decision probes record the P2
network-simplex weighted-span objective (10), three P3 sweep candidate events, four BK directional candidates with
alignment and shift arrays, and five P5 states on each of four boundaries plus their actual widths. The imported
graph's 173 resolved Core/Layered options are serialized separately from the explicit input options.

Lineage review exposed a serializer bug: ELK's numeric dummy designation was incorrectly treated as source lineage.
Dummy node and port lineage now comes from their incident logical edge IDs, and the validator checks it against
every snapshot's edge references. For the smoke graph, long-edge dummies trace to `e_ca` and `e_af`; chain/diamond
contain no long-edge dummies. The manifest validator recomputes SHA-256 from every explicit graph input.

The separate `p5_critical_split_001` probe calls the real upstream dependency, cycle-detection and splitter code
with crossing segments. It observes two opposed critical dependencies, one feedback selection, a split at coordinate
5 and three segments afterwards. This is a mechanism-level test, not a full P1-P5 graph oracle.

## Remaining limits

The smoke, chain, diamond, reconvergent-long-edge and direct split probes now cover the required categories of internal decisions, but they do not prove
those observations generalize to every manifest case. In particular, the smoke P3 candidates are low-crossing,
and its normal P5 boundaries do not split; the separate mechanism probe isolates the latter path. The next gate is
to run nontrivial port-order mechanism graphs and focused product cases through the same oracle, then
review first-divergence diagnostics. No production rewrite is authorized by these successful probes alone.

These probes belong only in the research source copy and versioned harness patch. ER-04 remains closed until the
stratified evidence is present and reviewed. A final drawing or attractive screenshot cannot substitute for it.
