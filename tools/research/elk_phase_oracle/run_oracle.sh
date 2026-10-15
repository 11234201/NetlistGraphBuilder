#!/usr/bin/env bash
set -euo pipefail

oracle_root="${ELK_ORACLE_ROOT:-/home/wzh/my_code/elk-layered-phase-oracle}"
upstream_root="${ELK_UPSTREAM_ROOT:-/home/wzh/open_source/elk-layered-phase-oracle-pinned}"
jdk_root="${ELK_JDK_ROOT:-/home/wzh/open_source/toolchains/jdk17_apt/root/usr/lib/jvm/java-17-openjdk-amd64}"
maven_root="${ELK_MAVEN_ROOT:-/home/wzh/open_source/toolchains/apache-maven-3.9.9}"
script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
focused_input="${ELK_ORACLE_FOCUSED_INPUT:-${script_root}/../../../tests/fixtures/elk_parity/inputs/sop015_5426_focused_3_3.tsv}"
test_bundle="${upstream_root}/test/org.eclipse.elk.alg.layered.test"
algorithm_source="${upstream_root}/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered"
test_source="${test_bundle}/oracle_src/org/eclipse/elk/alg/layered/PhaseOracleTest.java"
test_manifest="${test_bundle}/META-INF/MANIFEST.MF"
output_path="${1:-${oracle_root}/output/oracle_smoke_001.json}"

test -f "${upstream_root}/build/pom.xml"
test -x "${jdk_root}/bin/java"
test -x "${maven_root}/bin/mvn"
test -f "${focused_input}"
mkdir -p "$(dirname "${output_path}")"
mkdir -p "$(dirname "${test_source}")"
cp "${script_root}/PhaseOracleTest.java" "${test_source}"
cp "${script_root}/PhaseOracleTrace.java" "${algorithm_source}/PhaseOracleTrace.java"
cp "${script_root}/PhaseOracleBkTrace.java" "${algorithm_source}/p4nodes/bk/PhaseOracleBkTrace.java"
cp "${script_root}/PhaseOracleRoutingTrace.java" "${algorithm_source}/p5edges/orthogonal/PhaseOracleRoutingTrace.java"
cp "${script_root}/PhaseOracleP5ConflictProbe.java" "${algorithm_source}/p5edges/orthogonal/PhaseOracleP5ConflictProbe.java"
cp "${script_root}/LayeredTest.MANIFEST.MF" "${test_manifest}"
cp "${script_root}/LayeredTest.build.properties" "${test_bundle}/build.properties"
mkdir -p "${test_bundle}/oracle_inputs"
cp "${focused_input}" "${test_bundle}/oracle_inputs/sop015_5426_focused_3_3.tsv"
node "${script_root}/apply_upstream_probe.mjs" "${upstream_root}"

cd "${upstream_root}/build"
env \
  JAVA_HOME="${jdk_root}" \
  PATH="${maven_root}/bin:${jdk_root}/bin:/usr/local/bin:/usr/bin:/bin" \
  "${maven_root}/bin/mvn" \
  -B -ntp \
  -DskipTests=true \
  -Ddash.skip=true \
  -pl :org.eclipse.elk.alg.layered \
  -am \
  install

env \
  JAVA_HOME="${jdk_root}" \
  PATH="${maven_root}/bin:${jdk_root}/bin:/usr/local/bin:/usr/bin:/bin" \
  "${maven_root}/bin/mvn" \
  -Ddash.skip=true \
  -DfailIfNoTests=false \
  -Dtest=PhaseOracleTest \
  -pl :org.eclipse.elk.alg.layered.test \
  -am \
  clean verify

cp "${test_bundle}/target/elk-phase-oracle/oracle_smoke_001.json" "${output_path}"
cp "${test_bundle}/target/elk-phase-oracle/p5_critical_split_001.json" \
  "$(dirname "${output_path}")/p5_critical_split_001.json"
for case_id in chain_4 diamond reconvergent_long_edge multi_port_fanout_hyperedge sop015_5426_focused_3_3 self_loop_opposing self_loop_same_side self_loop_nested; do
  cp "${test_bundle}/target/elk-phase-oracle/${case_id}.json" \
    "$(dirname "${output_path}")/${case_id}.json"
done
for trace_path in "${test_bundle}/target/elk-phase-oracle/"*.bk_decisions.json; do
  cp "${trace_path}" "$(dirname "${output_path}")/$(basename "${trace_path}")"
done
if [[ -n "${ELK_ORACLE_INPUT_DIR:-}" ]]; then
  for input_path in "${ELK_ORACLE_INPUT_DIR}"/*.tsv; do
    case_id="$(basename "${input_path}" .tsv)"
    cp "${test_bundle}/target/elk-phase-oracle/${case_id}.json" \
      "$(dirname "${output_path}")/${case_id}.json"
    sha256sum "$(dirname "${output_path}")/${case_id}.json"
  done
fi
sha256sum "${output_path}"
sha256sum "$(dirname "${output_path}")/p5_critical_split_001.json"
sha256sum "$(dirname "${output_path}")/chain_4.json"
sha256sum "$(dirname "${output_path}")/diamond.json"
sha256sum "$(dirname "${output_path}")/reconvergent_long_edge.json"
sha256sum "$(dirname "${output_path}")/multi_port_fanout_hyperedge.json"
sha256sum "$(dirname "${output_path}")/sop015_5426_focused_3_3.json"
