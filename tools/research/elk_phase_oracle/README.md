# ELK Java phase oracle harness

This research-only harness executes the real white-box processor schedule from Eclipse ELK commit
`28e5173243cab0cf4e2c9816c803bc0d5c47ab24`. It is not production code and is not a substitute for the browser-native
implementation.

The checked-in Java file, research-only test manifest and build properties are copied into ELK's existing layered
test bundle. The build properties compile only `oracle_src/`; the manifest removes its unused dependency on ELK's
broad algorithm-test helper bundle. The harness registers only Core and Layered metadata providers. Tycho still
supplies the exact OSGi, EMF, Guava and generated-option classpath.
`LayeredLayoutProvider.startLayoutTest()` imports the graph, and
`ElkLayered.runLayoutTestStep()` executes one actual configured processor at a time. The harness serializes the graph
after every processor and labels P1, P2, long-edge split, P3, dummy merge, P4, P5 and restoration milestones.

The remote runner expects:

- extracted pinned ELK source at `/home/wzh/open_source/elk-layered-phase-oracle-pinned`;
- Java 17 at `/home/wzh/open_source/toolchains/jdk17_apt/root/usr/lib/jvm/java-17-openjdk-amd64`;
- Maven 3.9.9 at `/home/wzh/open_source/toolchains/apache-maven-3.9.9`.

Copy this directory to `/home/wzh/my_code/elk-layered-phase-oracle/harness`, then run:

```sh
bash /home/wzh/my_code/elk-layered-phase-oracle/harness/run_oracle.sh
```

Environment variables `ELK_ORACLE_ROOT`, `ELK_UPSTREAM_ROOT`, `ELK_JDK_ROOT` and `ELK_MAVEN_ROOT` override those
locations. A positional argument overrides the JSON output path. Maven/Tycho dependencies and generated build output
remain remote; only the normalized small oracle result is copied back to the repository.

The runner reads the durable SOP015 TSV from `tests/fixtures/elk_parity/inputs/` relative to this repository.
When the harness is copied alone, set `ELK_ORACLE_FOCUSED_INPUT` to that separately copied input file.
It no longer relies on an untracked `harness/inputs` directory.

Harness revision 1.4.0 optionally imports additional run-local provider inputs from `ELK_ORACLE_INPUT_DIR`.
Use an absolute directory containing `<case_id>.tsv` files captured by `export_focused_inputs.mjs`.
The exporter keeps the historical three-Focused default; explicitly selected mapped IDs capture full graphs.
Capture preserves actual provider node, port and edge array order, measured geometry, and **node endpoints**
(for portless hubs); it must not manufacture fixed ports to make a port-only importer succeed.
Auxiliary IDs cannot collide with the durable oracle IDs. Large auxiliary snapshots remain remote and do not
automatically expand checked-in manifest phase coverage or waive quality gates.

The current harness emits schema 1.1.0 snapshots. Research-only source probes record the P2 objective, P3 sweep
candidates, BK arrays/candidate choice and P5 dependency, split, slot and boundary-width decisions. A second JUnit
test exercises the actual critical-dependency and segment-split path directly. These are smoke/mechanism proofs,
not yet full stratified-corpus parity; production implementation remains gated on that review.

The exporter also runs `chain_4`, `diamond` and `reconvergent_long_edge` from explicit manifest graphs. Their snapshots are checked with
`validate_oracle.mjs <path>`. The serializer derives dummy lineage from incident logical source edges, not ELK's
numeric dummy designation; `validate_artifacts.mjs` verifies the manifest graph digests.

Quality-isolation diagnostics (not production providers):

- `isolate_p3_quality.mjs <oracle.json> <logical-edge-id> <output-dir>` fixes actual upstream pre-P3 ranks,
  measured ports and initial order, verifies the retained crossing counter, then compares P3/merge/BK candidates.
- `probe_portless_aliases.mjs <capture.json> <witness.json> <output-dir>` freezes actual P1/ranks/perturbation key,
  changes only implicit source-port identity, and reports distinct chain heights/roots. Separate variant digests
  are retained; this is not a canonical-input equality claim or a P5/final quality result.
- `probe_display_name_ordering.mjs <output-dir>` changes only display names on the six durable phase inputs.
  It asserts unchanged non-display P0/P1/P2 data and reports the first P3 order divergence without selecting a seed.

Each CLI saves independent before/after file-set audits. A hypothesis passing an isolated phase does not waive
product quality, strict validation, mapped-worker gates or the user visual decision.

`compare_native_phases.mjs [oracle.json ...]` compares explicitly supplied phase files; without arguments it retains
the six durable defaults. A missing or invalid explicit file fails, never silently selecting defaults. This comparator
reports imported-model P1/P2/P3 differences; use the proper-input isolation tool before attributing them to P3 alone.

Harness 1.5.0 exports a separate `<case_id>.bk_decisions.json` sidecar, traceVersion 1.0.0, with threshold calls,
selected edge endpoints/owned-port indices, block finishing, deferred queue picks, moves and reverse retries.
It does not extend schema 1.1.0 phase payloads. Its node indices are interpreted only against the connected
pre-P4 graph. Verify the complete old snapshots unchanged (apart from harness provenance) before using new events.
`probe_bk_boundary_threshold.mjs <oracle.json> <output-dir>` mechanically observes the candidate's existing
compactor without overwriting production source; the observer must match the unobserved result on every field.
Despite the filename, it does not skip boundary thresholds: upstream also calls threshold in placeBlock's else branch.

`compare_bk_decisions.mjs <before-oracle> <observed-oracle> <sidecar> <candidate-report> <output.json>` verifies original
snapshot invariance and compares the ordered decisions through connected pre-P4 identities. Empty/partial source
traces are rejected via exact four-candidate block-finish coverage. Only coordinate fields use the named 1e-7 tolerance.
`replay_bk_port_ties.mjs <oracle> <sidecar> <output-dir>` is a causal same-owned-port order replay, never a provider:
it cannot bypass edge eligibility or reorder P3 ports. A replay matching ELK does not authorize copying allocation
order into production or claiming product/visual acceptance.

`isolate_p3_initialization.mjs <oracle> <output-dir>` freezes upstream ranks and the native perturbation key;
reports eight predeclared layer/port/geometry combinations plus four normal/dummy port controls, complete
retained orders and concise same-position port witnesses. All controls are research-only. Matching crossing
counts do not establish matching layer orders or product acceptance. Before/after file-set audits reject mixed runs.
