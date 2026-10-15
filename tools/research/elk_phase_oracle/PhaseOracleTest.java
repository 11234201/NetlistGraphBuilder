/*
 * Research-only ELK phase oracle harness.
 *
 * This file is compiled against the pinned upstream ELK test bundle. It does not
 * enter the product runtime and remains subject to the upstream EPL-2.0 context.
 */
package org.eclipse.elk.alg.layered;

import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Comparator;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;

import org.eclipse.elk.alg.layered.graph.LEdge;
import org.eclipse.elk.alg.layered.graph.LGraph;
import org.eclipse.elk.alg.layered.graph.LNode;
import org.eclipse.elk.alg.layered.graph.LPort;
import org.eclipse.elk.alg.layered.graph.Layer;
import org.eclipse.elk.alg.layered.options.CrossingMinimizationStrategy;
import org.eclipse.elk.alg.layered.options.CycleBreakingStrategy;
import org.eclipse.elk.alg.layered.options.InternalProperties;
import org.eclipse.elk.alg.layered.options.LayeredOptions;
import org.eclipse.elk.alg.layered.p4nodes.bk.PhaseOracleBkTrace;
import org.eclipse.elk.alg.layered.options.LayeringStrategy;
import org.eclipse.elk.alg.layered.options.NodePlacementStrategy;
import org.eclipse.elk.alg.layered.p5edges.orthogonal.PhaseOracleP5ConflictProbe;
import org.eclipse.elk.alg.layered.options.LayeredMetaDataProvider;
import org.eclipse.elk.core.alg.ILayoutProcessor;
import org.eclipse.elk.core.data.LayoutMetaDataService;
import org.eclipse.elk.core.math.KVector;
import org.eclipse.elk.core.math.KVectorChain;
import org.eclipse.elk.core.options.Direction;
import org.eclipse.elk.core.options.EdgeRouting;
import org.eclipse.elk.core.options.PortConstraints;
import org.eclipse.elk.core.options.PortSide;
import org.eclipse.elk.core.options.SizeConstraint;
import org.eclipse.elk.core.options.CoreOptions;
import org.eclipse.elk.graph.ElkEdge;
import org.eclipse.elk.graph.ElkConnectableShape;
import org.eclipse.elk.graph.ElkNode;
import org.eclipse.elk.graph.ElkPort;
import org.eclipse.elk.graph.util.ElkGraphUtil;
import org.eclipse.elk.graph.properties.IProperty;
import org.junit.Test;

/** Exports normalized intermediate graphs from the real upstream processor schedule. */
public class PhaseOracleTest {

    private static final String SOURCE_COMMIT = "28e5173243cab0cf4e2c9816c803bc0d5c47ab24";
    private static final String HARNESS_REVISION = "1.5.0";
    private static final String INPUT_SPEC = String.join("\n",
            "a:40x30", "b:50x34", "c:44x28", "d:46x38", "e:48x32", "f:52x36",
            "e_ab:a>b:n_ab", "e_bc:b>c:n_bc", "e_ca:c>a:n_ca", "e_ad:a>d:n_fan",
            "e_ae:a>e:n_fan", "e_df:d>f:n_df", "e_ef:e>f:n_ef", "e_af:a>f:n_long");

    private static final Map<String, String> PHYSICAL_NETS = Map.ofEntries(
            Map.entry("e_ab", "n_ab"), Map.entry("e_bc", "n_bc"), Map.entry("e_ca", "n_ca"),
            Map.entry("e_ad", "n_fan"), Map.entry("e_ae", "n_fan"), Map.entry("e_df", "n_df"),
            Map.entry("e_ef", "n_ef"), Map.entry("e_af", "n_long"));

    private static final Map<LNode, String> DUMMY_NODE_IDS = new IdentityHashMap<>();
    private static final Map<LPort, String> DUMMY_PORT_IDS = new IdentityHashMap<>();
    private static final Map<LEdge, String> EDGE_INSTANCE_IDS = new IdentityHashMap<>();
    private static Map<String, String> activePhysicalNets = PHYSICAL_NETS;

    @Test
    public void exportOracleSmokeSnapshots() throws Exception {
        exportGraphCase("oracle_smoke_001", INPUT_SPEC, createInputGraph(), PHYSICAL_NETS,
                optionMap(), true);
    }

    @Test
    public void exportStratifiedSyntheticSnapshots() throws Exception {
        for (String caseId : List.of("chain_4", "diamond", "reconvergent_long_edge",
                "multi_port_fanout_hyperedge")) {
            String inputSpec;
            Map<String, String> physicalNets;
            switch (caseId) {
            case "chain_4":
                inputSpec = String.join("\n", "a:40x30", "b:40x30", "c:40x30", "d:40x30",
                        "e_ab:a>b:n_ab", "e_bc:b>c:n_bc", "e_cd:c>d:n_cd");
                physicalNets = Map.of("e_ab", "n_ab", "e_bc", "n_bc", "e_cd", "n_cd");
                break;
            case "diamond":
                inputSpec = String.join("\n", "a:40x30", "b:40x30", "c:40x30", "d:40x30",
                        "e_ab:a>b:n_ab", "e_ac:a>c:n_ac", "e_bd:b>d:n_bd", "e_cd:c>d:n_cd");
                physicalNets = Map.of("e_ab", "n_ab", "e_ac", "n_ac", "e_bd", "n_bd", "e_cd", "n_cd");
                break;
            case "reconvergent_long_edge":
                inputSpec = String.join("\n", "a:40x30", "b:40x30", "c:40x30", "d:40x30", "e:40x30",
                        "e_ab:a>b:n_ab", "e_bc:b>c:n_bc", "e_cd:c>d:n_cd", "e_ae:a>e:n_ae",
                        "e_ed:e>d:n_ed", "e_ad:a>d:n_long");
                physicalNets = Map.of("e_ab", "n_ab", "e_bc", "n_bc", "e_cd", "n_cd",
                        "e_ae", "n_ae", "e_ed", "n_ed", "e_ad", "n_long");
                break;
            default:
                inputSpec = String.join("\n", "a:40x30", "b:40x30", "c:40x30", "d:40x30",
                        "e:40x30", "f:40x60", "e_ab:a>b:n_fan", "e_ac:a>c:n_fan",
                        "e_ad:a>d:n_fan", "e_ae:a>e:n_fan", "e_bf:b>f:n_bf",
                        "e_cf:c>f:n_cf", "e_df:d>f:n_df", "e_ef:e>f:n_ef");
                physicalNets = Map.of("e_ab", "n_fan", "e_ac", "n_fan", "e_ad", "n_fan",
                        "e_ae", "n_fan", "e_bf", "n_bf", "e_cf", "n_cf", "e_df", "n_df",
                        "e_ef", "n_ef");
                break;
            }
            exportGraphCase(caseId, inputSpec, createSyntheticGraph(caseId), physicalNets,
                    syntheticOptionMap(), false);
        }
    }

    private static void exportGraphCase(final String caseId, final String inputSpec,
            final ElkNode input, final Map<String, String> physicalNets,
            final Map<String, Object> explicitOptions, final boolean requireAllMilestones) throws Exception {
        DUMMY_NODE_IDS.clear();
        DUMMY_PORT_IDS.clear();
        EDGE_INSTANCE_IDS.clear();
        activePhysicalNets = physicalNets;
        PhaseOracleTrace.reset();
        PhaseOracleBkTrace.resetDecisions();
        for (ElkNode node : input.getChildren()) {
            assertTrue("input port constraint mismatch on " + node.getIdentifier(),
                    node.getProperty(LayeredOptions.PORT_CONSTRAINTS).name()
                            .equals(explicitOptions.get("portConstraints")));
        }
        LayoutMetaDataService.getInstance().registerLayoutMetaDataProviders(
                new CoreOptions(), new LayeredMetaDataProvider());

        LayeredLayoutProvider provider = new LayeredLayoutProvider();
        ElkLayered.TestExecutionState state = provider.startLayoutTest(input);
        Map<String, Object> resolvedOptions = resolvedOptions(state.getGraphs());
        ElkLayered algorithm = provider.getLayoutAlgorithm();
        List<Map<String, Object>> snapshots = new ArrayList<>();
        Set<String> milestones = new LinkedHashSet<>();

        snapshots.add(snapshot(0, "imported", null, null, "milestone", state.getGraphs()));
        milestones.add("imported");

        List<ILayoutProcessor<LGraph>> processors = algorithm.getLayoutTestConfiguration(state);
        for (int slot = 0; slot < processors.size(); slot++) {
            ILayoutProcessor<LGraph> processor = processors.get(slot);
            algorithm.runLayoutTestStep(state);
            String boundary = boundaryFor(processor.getClass().getSimpleName());
            String event = "processor".equals(boundary) ? "after" : "milestone";
            snapshots.add(snapshot(snapshots.size(), boundary, slot,
                    processor.getClass().getName(), event, state.getGraphs()));
            milestones.add(boundary);
        }

        snapshots.add(snapshot(snapshots.size(), "final", null, null, "milestone", state.getGraphs()));
        milestones.add("final");

        List<String> requiredMilestones = requireAllMilestones
                ? List.of("imported", "p1", "p2", "long_edge_split", "p3",
                        "hyperedge_dummy_merge", "p4", "p5", "restored", "final")
                : List.of("imported", "p1", "p2", "p3", "p4", "p5", "final");
        for (String required : requiredMilestones) {
            assertTrue("missing milestone " + required, milestones.contains(required));
        }

        Map<String, Object> document = object(
                "schemaVersion", "1.1.0",
                "producer", object(
                        "name", "upstream-elk-java-phase-oracle",
                        "sourceCommit", SOURCE_COMMIT,
                        "harnessRevision", HARNESS_REVISION,
                        "license", "EPL-2.0"),
                "fixture", object(
                        "caseId", caseId,
                        "manifestVersion", "1.0.0",
                        "inputDigest", "sha256:" + sha256(inputSpec)),
                "run", object(
                        "seed", 1,
                        "options", explicitOptions,
                        "resolvedOptions", resolvedOptions),
                "snapshots", snapshots);

        Path output = Paths.get(System.getProperty("elk.oracle.output",
                "target/elk-phase-oracle/oracle_smoke_001.json")).toAbsolutePath();
        if (!caseId.equals("oracle_smoke_001")) {
            output = Paths.get("target/elk-phase-oracle/" + caseId + ".json").toAbsolutePath();
        }
        Files.createDirectories(output.getParent());
        Files.writeString(output, Json.write(document) + "\n", StandardCharsets.UTF_8);
        Map<String, Object> decisionTrace = object("traceVersion", "1.0.0", "caseId", caseId,
                "sourceCommit", SOURCE_COMMIT, "harnessRevision", HARNESS_REVISION,
                "inputDigest", "sha256:" + sha256(inputSpec),
                "scope", "connected pre-P4 BK node indices and owned-port order",
                "events", PhaseOracleBkTrace.drainDecisions());
        Files.writeString(output.resolveSibling(caseId + ".bk_decisions.json"),
                Json.write(decisionTrace) + "\n", StandardCharsets.UTF_8);
        System.out.println("ELK_PHASE_ORACLE_OUTPUT=" + output);
    }

    @Test
    public void exportCriticalSplitMechanismProbe() throws Exception {
        List<Map<String, Object>> events = PhaseOracleP5ConflictProbe.run();

        Map<String, Object> document = object(
                "probeVersion", "1.0.0",
                "sourceCommit", SOURCE_COMMIT,
                "fixture", "p5_critical_split_001",
                "seed", 1,
                "input", object("firstIncoming", List.of(0), "firstOutgoing", List.of(10),
                        "secondIncoming", List.of(10), "secondOutgoing", List.of(0),
                        "criticalThreshold", 0.2, "edgeSpacing", 10),
                "events", events);
        Path output = Paths.get("target/elk-phase-oracle/p5_critical_split_001.json").toAbsolutePath();
        Files.createDirectories(output.getParent());
        Files.writeString(output, Json.write(document) + "\n", StandardCharsets.UTF_8);
        System.out.println("ELK_P5_CRITICAL_SPLIT_OUTPUT=" + output);
    }

    @Test
    public void exportFixedSelfLoopSnapshots() throws Exception {
        for (String caseId : List.of("self_loop_opposing", "self_loop_same_side", "self_loop_nested")) {
            ElkNode graph = ElkGraphUtil.createGraph();
            configureGraph(graph, true);
            Map<String, ElkNode> nodes = new LinkedHashMap<>();
            addNode(graph, nodes, "a", 60, 60, PortConstraints.FIXED_POS);
            addNode(graph, nodes, "b", 40, 30, PortConstraints.FIXED_POS);
            Map<String, ElkPort> sharedSources = new LinkedHashMap<>();
            addEdge(nodes, sharedSources, "e_ab", "a", "b", "n_ab");
            ElkPort source = addPort(nodes.get("a"), "loop_out", PortSide.EAST);
            ElkPort target = addPort(nodes.get("a"), "loop_in",
                    caseId.equals("self_loop_same_side") ? PortSide.EAST : PortSide.WEST);
            ElkEdge loop = ElkGraphUtil.createSimpleEdge(source, target);
            loop.setIdentifier("e_loop");
            Map<String, String> nets = new LinkedHashMap<>();
            nets.put("e_ab", "n_ab");
            nets.put("e_loop", "n_loop");
            if (caseId.equals("self_loop_nested")) {
                ElkPort nestedTarget = addPort(nodes.get("a"), "nested_in", PortSide.WEST);
                ElkEdge nested = ElkGraphUtil.createSimpleEdge(source, nestedTarget);
                nested.setIdentifier("e_nested");
                nets.put("e_nested", "n_loop");
            }
            for (ElkNode node : nodes.values()) placeFixedPorts(node);
            exportGraphCase(caseId, caseId + ":fixed-60x60-self-loop", graph, nets, optionMap(), false);
        }
    }

    @Test
    public void exportFocusedProviderInput() throws Exception {
        Path inputPath = Paths.get("oracle_inputs/sop015_5426_focused_3_3.tsv");
        assertTrue("missing captured Focused provider input", Files.isRegularFile(inputPath));
        exportCapturedInput(inputPath);
    }

    /** Optional run-local inputs; durable original oracles are never overwritten. */
    @Test
    public void exportAuxiliaryProviderInputs() throws Exception {
        String inputDirectory = System.getenv("ELK_ORACLE_INPUT_DIR");
        if (inputDirectory == null || inputDirectory.isBlank()) return;
        Path inputRoot = Paths.get(inputDirectory).toAbsolutePath();
        assertTrue("missing auxiliary input directory", Files.isDirectory(inputRoot));
        List<Path> inputs;
        try (java.util.stream.Stream<Path> entries = Files.list(inputRoot)) {
            inputs = entries.filter(path -> Files.isRegularFile(path)
                    && path.getFileName().toString().endsWith(".tsv"))
                    .sorted().collect(Collectors.toList());
        }
        assertTrue("no auxiliary captured inputs", !inputs.isEmpty());
        for (Path inputPath : inputs) {
            String caseId = inputPath.getFileName().toString().replaceFirst("\\.tsv$", "");
            assertTrue("auxiliary case collides with durable oracle", !List.of("oracle_smoke_001",
                    "chain_4", "diamond", "reconvergent_long_edge", "multi_port_fanout_hyperedge",
                    "sop015_5426_focused_3_3", "self_loop_opposing", "self_loop_same_side",
                    "self_loop_nested", "p5_critical_split_001").contains(caseId));
            exportCapturedInput(inputPath);
        }
    }

    private static void exportCapturedInput(final Path inputPath) throws Exception {
        String serialized = Files.readString(inputPath, StandardCharsets.UTF_8);
        int headerEnd = serialized.indexOf('\n');
        String[] header = serialized.substring(0, headerEnd).split("\t", -1);
        String inputSpec = serialized.substring(headerEnd + 1);
        assertTrue("invalid input header", header.length == 3 && header[0].equals("CASE"));
        assertTrue("unsafe captured case identifier", decode(header[1]).matches("[a-z0-9_]+"));
        assertTrue("captured filename/header mismatch", inputPath.getFileName().toString()
                .equals(decode(header[1]) + ".tsv"));
        assertTrue("captured input digest mismatch", header[2].equals("sha256:" + sha256(inputSpec)));
        Map<String, Object> options = new LinkedHashMap<>();
        Map<String, ElkNode> nodes = new LinkedHashMap<>();
        Map<String, ElkPort> ports = new LinkedHashMap<>();
        Map<String, String> physicalNets = new LinkedHashMap<>();
        ElkNode graph = ElkGraphUtil.createGraph();
        configureGraph(graph, false);
        for (String row : inputSpec.split("\n")) {
            String[] values = row.split("\t", -1);
            switch (values[0]) {
            case "OPTION":
                String value = values[2];
                options.put(values[1], value.matches("-?[0-9]+(?:\\.[0-9]+)?")
                        ? Double.valueOf(value) : value);
                break;
            case "NODE":
                addNode(graph, nodes, decode(values[1]), Double.parseDouble(values[2]),
                        Double.parseDouble(values[3]), PortConstraints.valueOf(values[4]));
                break;
            case "PORT":
                ElkPort port = addPort(nodes.get(decode(values[1])), decode(values[2]),
                        PortSide.valueOf(values[3]));
                port.setX(Double.parseDouble(values[4]));
                port.setY(Double.parseDouble(values[5]));
                port.setWidth(Double.parseDouble(values[6]));
                port.setHeight(Double.parseDouble(values[7]));
                ports.put(port.getIdentifier(), port);
                break;
            case "EDGE":
                String edgeId = decode(values[1]);
                String sourceId = decode(values[2]);
                String targetId = decode(values[3]);
                ElkConnectableShape source = ports.containsKey(sourceId) ? ports.get(sourceId) : nodes.get(sourceId);
                ElkConnectableShape target = ports.containsKey(targetId) ? ports.get(targetId) : nodes.get(targetId);
                assertTrue("unknown captured source endpoint", source != null);
                assertTrue("unknown captured target endpoint", target != null);
                ElkEdge edge = ElkGraphUtil.createSimpleEdge(source, target);
                edge.setIdentifier(edgeId);
                physicalNets.put(edgeId, decode(values[4]));
                break;
            default:
                throw new IllegalArgumentException("unknown captured input row: " + values[0]);
            }
        }
        graph.setProperty(LayeredOptions.SPACING_NODE_NODE, ((Number) options.get("nodeNodeSpacing")).doubleValue());
        graph.setProperty(LayeredOptions.SPACING_NODE_NODE_BETWEEN_LAYERS,
                ((Number) options.get("nodeNodeBetweenLayers")).doubleValue());
        exportGraphCase(decode(header[1]), inputSpec, graph, physicalNets, options, false);
    }

    private static String decode(final String value) {
        return new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8);
    }

    private static ElkNode createInputGraph() {
        ElkNode graph = ElkGraphUtil.createGraph();
        graph.setProperty(LayeredOptions.DIRECTION, Direction.RIGHT);
        graph.setProperty(LayeredOptions.EDGE_ROUTING, EdgeRouting.ORTHOGONAL);
        graph.setProperty(LayeredOptions.CYCLE_BREAKING_STRATEGY, CycleBreakingStrategy.GREEDY);
        graph.setProperty(LayeredOptions.LAYERING_STRATEGY, LayeringStrategy.NETWORK_SIMPLEX);
        graph.setProperty(LayeredOptions.CROSSING_MINIMIZATION_STRATEGY,
                CrossingMinimizationStrategy.LAYER_SWEEP);
        graph.setProperty(LayeredOptions.NODE_PLACEMENT_STRATEGY, NodePlacementStrategy.BRANDES_KOEPF);
        graph.setProperty(LayeredOptions.RANDOM_SEED, 1);
        graph.setProperty(LayeredOptions.NODE_PLACEMENT_FAVOR_STRAIGHT_EDGES, true);

        Map<String, ElkNode> nodes = new LinkedHashMap<>();
        addNode(graph, nodes, "a", 40, 30);
        addNode(graph, nodes, "b", 50, 34);
        addNode(graph, nodes, "c", 44, 28);
        addNode(graph, nodes, "d", 46, 38);
        addNode(graph, nodes, "e", 48, 32);
        addNode(graph, nodes, "f", 52, 36);

        Map<String, ElkPort> sharedSources = new LinkedHashMap<>();
        addEdge(nodes, sharedSources, "e_ab", "a", "b", "n_ab");
        addEdge(nodes, sharedSources, "e_bc", "b", "c", "n_bc");
        addEdge(nodes, sharedSources, "e_ca", "c", "a", "n_ca");
        addEdge(nodes, sharedSources, "e_ad", "a", "d", "n_fan");
        addEdge(nodes, sharedSources, "e_ae", "a", "e", "n_fan");
        addEdge(nodes, sharedSources, "e_df", "d", "f", "n_df");
        addEdge(nodes, sharedSources, "e_ef", "e", "f", "n_ef");
        addEdge(nodes, sharedSources, "e_af", "a", "f", "n_long");

        for (ElkNode node : nodes.values()) {
            placeFixedPorts(node);
        }
        return graph;
    }

    private static ElkNode createSyntheticGraph(final String caseId) {
        ElkNode graph = ElkGraphUtil.createGraph();
        configureGraph(graph, false);
        Map<String, ElkNode> nodes = new LinkedHashMap<>();
        for (String id : List.of("a", "b", "c", "d")) {
            addNode(graph, nodes, id, 40, 30, PortConstraints.FIXED_ORDER);
        }
        if (caseId.equals("reconvergent_long_edge")
                || caseId.equals("multi_port_fanout_hyperedge")) {
            addNode(graph, nodes, "e", 40, 30, PortConstraints.FIXED_ORDER);
        }
        if (caseId.equals("multi_port_fanout_hyperedge")) {
            addNode(graph, nodes, "f", 40, 60, PortConstraints.FIXED_ORDER);
        }
        Map<String, ElkPort> sharedSources = new LinkedHashMap<>();
        addEdge(nodes, sharedSources, "e_ab", "a", "b",
                caseId.equals("multi_port_fanout_hyperedge") ? "n_fan" : "n_ab");
        if (caseId.equals("chain_4")) {
            addEdge(nodes, sharedSources, "e_bc", "b", "c", "n_bc");
            addEdge(nodes, sharedSources, "e_cd", "c", "d", "n_cd");
        } else if (caseId.equals("diamond")) {
            addEdge(nodes, sharedSources, "e_ac", "a", "c", "n_ac");
            addEdge(nodes, sharedSources, "e_bd", "b", "d", "n_bd");
            addEdge(nodes, sharedSources, "e_cd", "c", "d", "n_cd");
        } else if (caseId.equals("reconvergent_long_edge")) {
            addEdge(nodes, sharedSources, "e_bc", "b", "c", "n_bc");
            addEdge(nodes, sharedSources, "e_cd", "c", "d", "n_cd");
            addEdge(nodes, sharedSources, "e_ae", "a", "e", "n_ae");
            addEdge(nodes, sharedSources, "e_ed", "e", "d", "n_ed");
            addEdge(nodes, sharedSources, "e_ad", "a", "d", "n_long");
        } else {
            addEdge(nodes, sharedSources, "e_ac", "a", "c", "n_fan");
            addEdge(nodes, sharedSources, "e_ad", "a", "d", "n_fan");
            addEdge(nodes, sharedSources, "e_ae", "a", "e", "n_fan");
            addEdge(nodes, sharedSources, "e_bf", "b", "f", "n_bf");
            addEdge(nodes, sharedSources, "e_cf", "c", "f", "n_cf");
            addEdge(nodes, sharedSources, "e_df", "d", "f", "n_df");
            addEdge(nodes, sharedSources, "e_ef", "e", "f", "n_ef");
        }
        for (ElkNode node : nodes.values()) placeFixedPorts(node);
        return graph;
    }

    private static void configureGraph(final ElkNode graph, final boolean favorStraightEdges) {
        graph.setProperty(LayeredOptions.DIRECTION, Direction.RIGHT);
        graph.setProperty(LayeredOptions.EDGE_ROUTING, EdgeRouting.ORTHOGONAL);
        graph.setProperty(LayeredOptions.CYCLE_BREAKING_STRATEGY, CycleBreakingStrategy.GREEDY);
        graph.setProperty(LayeredOptions.LAYERING_STRATEGY, LayeringStrategy.NETWORK_SIMPLEX);
        graph.setProperty(LayeredOptions.CROSSING_MINIMIZATION_STRATEGY,
                CrossingMinimizationStrategy.LAYER_SWEEP);
        graph.setProperty(LayeredOptions.NODE_PLACEMENT_STRATEGY, NodePlacementStrategy.BRANDES_KOEPF);
        graph.setProperty(LayeredOptions.RANDOM_SEED, 1);
        if (favorStraightEdges) graph.setProperty(LayeredOptions.NODE_PLACEMENT_FAVOR_STRAIGHT_EDGES, true);
    }

    private static void addNode(final ElkNode graph, final Map<String, ElkNode> nodes,
            final String id, final double width, final double height) {
        addNode(graph, nodes, id, width, height, PortConstraints.FIXED_POS);
    }

    private static void addNode(final ElkNode graph, final Map<String, ElkNode> nodes,
            final String id, final double width, final double height, final PortConstraints portConstraints) {
        ElkNode node = ElkGraphUtil.createNode(graph);
        node.setIdentifier(id);
        node.setWidth(width);
        node.setHeight(height);
        node.setProperty(LayeredOptions.NODE_SIZE_CONSTRAINTS, SizeConstraint.fixed());
        node.setProperty(LayeredOptions.PORT_CONSTRAINTS, portConstraints);
        nodes.put(id, node);
    }

    private static void addEdge(final Map<String, ElkNode> nodes, final Map<String, ElkPort> sharedSources,
            final String edgeId, final String sourceId, final String targetId, final String physicalNet) {
        ElkNode source = nodes.get(sourceId);
        ElkNode target = nodes.get(targetId);
        ElkPort sourcePort = sharedSources.computeIfAbsent(sourceId + ":" + physicalNet,
                key -> addPort(source, sourceId + "_out_" + physicalNet, PortSide.EAST));
        ElkPort targetPort = addPort(target, targetId + "_in_" + edgeId, PortSide.WEST);
        ElkEdge edge = ElkGraphUtil.createSimpleEdge(sourcePort, targetPort);
        edge.setIdentifier(edgeId);
    }

    private static ElkPort addPort(final ElkNode node, final String id, final PortSide side) {
        ElkPort port = ElkGraphUtil.createPort(node);
        port.setIdentifier(id);
        port.setWidth(0);
        port.setHeight(0);
        port.setProperty(LayeredOptions.PORT_SIDE, side);
        return port;
    }

    private static void placeFixedPorts(final ElkNode node) {
        Map<PortSide, List<ElkPort>> bySide = node.getPorts().stream()
                .collect(Collectors.groupingBy(port -> port.getProperty(LayeredOptions.PORT_SIDE),
                        LinkedHashMap::new, Collectors.toList()));
        for (Map.Entry<PortSide, List<ElkPort>> entry : bySide.entrySet()) {
            List<ElkPort> ports = entry.getValue();
            for (int index = 0; index < ports.size(); index++) {
                ElkPort port = ports.get(index);
                double y = (index + 1) * node.getHeight() / (ports.size() + 1);
                port.setY(y);
                port.setX(entry.getKey() == PortSide.EAST ? node.getWidth() : 0);
            }
        }
    }

    private static Map<String, Object> optionMap() {
        return object(
                "algorithm", "org.eclipse.elk.layered",
                "direction", "RIGHT",
                "edgeRouting", "ORTHOGONAL",
                "cycleBreaking", "GREEDY",
                "layering", "NETWORK_SIMPLEX",
                "crossingMinimization", "LAYER_SWEEP",
                "nodePlacement", "BRANDES_KOEPF",
                "portConstraints", "FIXED_POS",
                "nodePlacementFavorStraightEdges", true,
                "randomSeed", 1);
    }

    private static Map<String, Object> syntheticOptionMap() {
        Map<String, Object> result = optionMap();
        result.remove("nodePlacementFavorStraightEdges");
        result.put("portConstraints", "FIXED_ORDER");
        return result;
    }

    private static Map<String, Object> resolvedOptions(final List<LGraph> graphs) throws Exception {
        Map<String, Object> values = new TreeMap<>();
        LGraph graph = graphs.get(0);
        for (Class<?> optionClass : List.of(CoreOptions.class, LayeredOptions.class)) {
            for (Field field : optionClass.getFields()) {
                if (!Modifier.isStatic(field.getModifiers()) || !IProperty.class.isAssignableFrom(field.getType())) {
                    continue;
                }
                IProperty<?> property = (IProperty<?>) field.get(null);
                values.put(property.getId(), canonicalOptionValue(graph.getProperty(property)));
            }
        }
        return values;
    }

    private static Object canonicalOptionValue(final Object value) {
        if (value == null || value instanceof Number || value instanceof Boolean || value instanceof String) {
            return value;
        }
        if (value instanceof Enum<?>) return ((Enum<?>) value).name();
        if (value instanceof Collection<?>) {
            List<String> items = ((Collection<?>) value).stream()
                    .map(item -> String.valueOf(canonicalOptionValue(item)))
                    .collect(Collectors.toList());
            if (value instanceof Set<?>) items.sort(String::compareTo);
            return items;
        }
        String representation = String.valueOf(value);
        if (representation.matches(".*@[0-9a-fA-F]+")) {
            throw new IllegalStateException("non-deterministic option value: " + value.getClass().getName());
        }
        return representation;
    }

    private static String boundaryFor(final String simpleName) {
        switch (simpleName) {
        case "GreedyCycleBreaker": return "p1";
        case "NetworkSimplexLayerer": return "p2";
        case "LongEdgeSplitter": return "long_edge_split";
        case "LayerSweepCrossingMinimizer": return "p3";
        case "HyperedgeDummyMerger": return "hyperedge_dummy_merge";
        case "BKNodePlacer": return "p4";
        case "OrthogonalEdgeRouter": return "p5";
        case "LongEdgeJoiner": return "restored";
        default: return "processor";
        }
    }

    private static Map<String, Object> snapshot(final int ordinal, final String boundary,
            final Integer slot, final String className, final String event, final List<LGraph> inputGraphs) {
        List<LGraph> graphs = new ArrayList<>(inputGraphs);
        graphs.sort(Comparator.comparing(PhaseOracleTest::componentKey));
        List<Map<String, Object>> components = new ArrayList<>();
        int componentIndex = 0;
        for (LGraph graph : graphs) {
            components.add(component(graph, "component-" + componentIndex++));
        }

        int nodeCount = components.stream()
                .mapToInt(component -> ((List<?>) component.get("nodes")).size()).sum();
        int edgeCount = components.stream()
                .mapToInt(component -> ((List<?>) component.get("edges")).size()).sum();
        int layerCount = components.stream()
                .mapToInt(component -> ((List<?>) component.get("layers")).size()).sum();

        return object(
                "ordinal", ordinal,
                "boundary", boundary,
                "processor", object("slot", slot, "className", className, "event", event),
                "components", components,
                "metrics", object("nodeCount", nodeCount, "edgeCount", edgeCount, "layerCount", layerCount),
                "phaseData", object("captureLevel", "processor-boundary-plus-events",
                        "events", PhaseOracleTrace.drain()));
    }

    private static String componentKey(final LGraph graph) {
        return allNodes(graph).stream().map(PhaseOracleTest::originId).filter(id -> id != null)
                .sorted().findFirst().orElse("~");
    }

    private static Map<String, Object> component(final LGraph graph, final String componentId) {
        List<LNode> nodes = allNodes(graph);
        Map<LNode, String> nodeIds = normalizedNodeIds(graph, nodes);
        Map<LPort, String> portIds = new IdentityHashMap<>();
        for (LNode node : nodes) {
            List<LPort> ports = node.getPorts();
            for (int index = 0; index < ports.size(); index++) {
                LPort port = ports.get(index);
                String origin = originId(port);
                portIds.put(port, origin != null && node.getType() == LNode.NodeType.NORMAL
                        ? origin : DUMMY_PORT_IDS.computeIfAbsent(port,
                                ignored -> "dummy-port:" + DUMMY_PORT_IDS.size()));
            }
        }

        Set<LEdge> edgeSet = java.util.Collections.newSetFromMap(new IdentityHashMap<>());
        List<LEdge> edges = new ArrayList<>();
        for (LNode node : nodes) {
            for (LPort port : node.getPorts()) {
                for (LEdge edge : port.getOutgoingEdges()) {
                    if (edgeSet.add(edge)) {
                        edges.add(edge);
                    }
                }
            }
        }
        Map<LEdge, String> edgeIds = normalizedEdgeIds(edges, portIds);

        List<Map<String, Object>> layerRecords = new ArrayList<>();
        for (int layerIndex = 0; layerIndex < graph.getLayers().size(); layerIndex++) {
            Layer layer = graph.getLayers().get(layerIndex);
            layerRecords.add(object("index", layerIndex,
                    "nodeIds", layer.getNodes().stream().map(nodeIds::get).collect(Collectors.toList())));
        }

        List<Map<String, Object>> nodeRecords = nodes.stream()
                .sorted(Comparator.comparing(nodeIds::get))
                .map(node -> nodeRecord(graph, node, nodeIds, portIds, edgeIds))
                .collect(Collectors.toList());
        List<Map<String, Object>> edgeRecords = edges.stream()
                .sorted(Comparator.comparing(edgeIds::get))
                .map(edge -> edgeRecord(edge, edgeIds, portIds))
                .collect(Collectors.toList());

        return object(
                "id", componentId,
                "layers", layerRecords,
                "layerlessNodeIds", graph.getLayerlessNodes().stream().map(nodeIds::get).sorted()
                        .collect(Collectors.toList()),
                "nodes", nodeRecords,
                "edges", edgeRecords,
                "graphSize", object("width", number(graph.getSize().x), "height", number(graph.getSize().y)));
    }

    private static List<LNode> allNodes(final LGraph graph) {
        Set<LNode> unique = java.util.Collections.newSetFromMap(new IdentityHashMap<>());
        List<LNode> ordered = new ArrayList<>();
        for (LNode node : graph.getLayerlessNodes()) {
            if (unique.add(node)) {
                ordered.add(node);
            }
        }
        for (Layer layer : graph.getLayers()) {
            for (LNode node : layer.getNodes()) {
                if (unique.add(node)) {
                    ordered.add(node);
                }
            }
        }
        return ordered;
    }

    private static Map<LNode, String> normalizedNodeIds(final LGraph graph, final List<LNode> nodes) {
        Map<LNode, String> result = new IdentityHashMap<>();
        for (LNode node : nodes) {
            String origin = originId(node);
            if (node.getType() == LNode.NodeType.NORMAL && origin != null) {
                result.put(node, origin);
                continue;
            }
            result.put(node, DUMMY_NODE_IDS.computeIfAbsent(node,
                    ignored -> "dummy:" + node.getType().name().toLowerCase(Locale.ROOT) + ":"
                            + DUMMY_NODE_IDS.size()));
        }
        return result;
    }

    private static Map<LEdge, String> normalizedEdgeIds(final List<LEdge> edges,
            final Map<LPort, String> portIds) {
        Map<LEdge, String> result = new IdentityHashMap<>();
        for (LEdge edge : edges) {
            String origin = logicalEdgeId(edge);
            result.put(edge, EDGE_INSTANCE_IDS.computeIfAbsent(edge,
                    ignored -> origin + ":segment:" + EDGE_INSTANCE_IDS.size()));
        }
        return result;
    }

    private static Map<String, Object> nodeRecord(final LGraph graph, final LNode node,
            final Map<LNode, String> nodeIds, final Map<LPort, String> portIds,
            final Map<LEdge, String> edgeIds) {
        Integer layer = node.getLayer() == null ? null : graph.getLayers().indexOf(node.getLayer());
        Integer order = node.getLayer() == null ? null : node.getLayer().getNodes().indexOf(node);
        List<Map<String, Object>> ports = new ArrayList<>();
        for (int index = 0; index < node.getPorts().size(); index++) {
            LPort port = node.getPorts().get(index);
            ports.add(portRecord(port, index, nodeIds.get(node), portIds.get(port), edgeIds,
                    node.getType() == LNode.NodeType.NORMAL));
        }
        return object(
                "id", nodeIds.get(node),
                "kind", node.getType().name().toLowerCase(Locale.ROOT),
                "layer", layer,
                "order", order,
                "box", box(node.getPosition().x, node.getPosition().y, node.getSize().x, node.getSize().y),
                "margins", object(
                        "top", number(node.getMargin().top), "right", number(node.getMargin().right),
                        "bottom", number(node.getMargin().bottom), "left", number(node.getMargin().left)),
                "ports", ports,
                "lineage", node.getType() == LNode.NodeType.NORMAL
                        ? lineage(originId(node)) : incidentLogicalEdges(node));
    }

    private static Map<String, Object> portRecord(final LPort port, final int order, final String nodeId,
            final String portId, final Map<LEdge, String> edgeIds, final boolean originalNode) {
        List<String> incoming = port.getIncomingEdges().stream().map(edgeIds::get).sorted()
                .collect(Collectors.toList());
        List<String> outgoing = port.getOutgoingEdges().stream().map(edgeIds::get).sorted()
                .collect(Collectors.toList());
        return object(
                "id", portId,
                "nodeId", nodeId,
                "kind", originalNode && originId(port) != null ? "original" : "dummy",
                "side", port.getSide().name(),
                "order", order,
                "box", box(port.getPosition().x, port.getPosition().y, port.getSize().x, port.getSize().y),
                "anchor", point(port.getAnchor().x, port.getAnchor().y),
                "incomingEdgeIds", incoming,
                "outgoingEdgeIds", outgoing,
                "lineage", originalNode ? lineage(originId(port)) : incidentLogicalEdges(port));
    }

    private static List<String> incidentLogicalEdges(final LNode node) {
        Set<String> logicalIds = new java.util.TreeSet<>();
        for (LPort port : node.getPorts()) logicalIds.addAll(incidentLogicalEdges(port));
        return new ArrayList<>(logicalIds);
    }

    private static List<String> incidentLogicalEdges(final LPort port) {
        Set<String> logicalIds = new java.util.TreeSet<>();
        for (LEdge edge : port.getIncomingEdges()) logicalIds.add(logicalEdgeId(edge));
        for (LEdge edge : port.getOutgoingEdges()) logicalIds.add(logicalEdgeId(edge));
        return new ArrayList<>(logicalIds);
    }

    private static Map<String, Object> edgeRecord(final LEdge edge, final Map<LEdge, String> edgeIds,
            final Map<LPort, String> portIds) {
        String logical = logicalEdgeId(edge);
        KVectorChain junctions = edge.getProperty(LayeredOptions.JUNCTION_POINTS);
        return object(
                "id", edgeIds.get(edge),
                "logicalEdgeId", logical,
                "physicalNetId", activePhysicalNets.getOrDefault(logical, logical),
                "sourcePortId", portIds.get(edge.getSource()),
                "targetPortId", portIds.get(edge.getTarget()),
                "reversed", edge.getProperty(InternalProperties.REVERSED),
                "bendPoints", points(edge.getBendPoints()),
                "junctionPoints", junctions == null ? List.of() : points(junctions),
                "lineage", List.of(logical));
    }

    private static String logicalEdgeId(final LEdge edge) {
        String origin = originId(edge);
        return origin == null ? "unknown" : origin;
    }

    private static String originId(final org.eclipse.elk.alg.layered.graph.LGraphElement element) {
        Object origin = element.getProperty(InternalProperties.ORIGIN);
        if (origin instanceof org.eclipse.elk.graph.ElkGraphElement) {
            String identifier = ((org.eclipse.elk.graph.ElkGraphElement) origin).getIdentifier();
            return identifier == null || identifier.isBlank() ? null : identifier;
        }
        return null;
    }

    private static List<String> lineage(final String origin) {
        return origin == null ? List.of() : List.of(origin);
    }

    private static List<Map<String, Object>> points(final Iterable<KVector> vectors) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (KVector vector : vectors) {
            result.add(point(vector.x, vector.y));
        }
        return result;
    }

    private static Map<String, Object> point(final double x, final double y) {
        return object("x", number(x), "y", number(y));
    }

    private static Map<String, Object> box(final double x, final double y,
            final double width, final double height) {
        return object("x", number(x), "y", number(y),
                "width", number(width), "height", number(height));
    }

    private static double number(final double value) {
        if (!Double.isFinite(value)) {
            throw new IllegalStateException("non-finite oracle coordinate");
        }
        return value == 0 ? 0 : value;
    }

    private static String sha256(final String value) throws NoSuchAlgorithmException {
        byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte item : digest) {
            result.append(String.format("%02x", item));
        }
        return result.toString();
    }

    private static Map<String, Object> object(final Object... values) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int index = 0; index < values.length; index += 2) {
            result.put((String) values[index], values[index + 1]);
        }
        return result;
    }

    /** Minimal deterministic JSON writer to keep the oracle independent of serializer ordering. */
    private static final class Json {
        private Json() { }

        static String write(final Object value) throws IOException {
            StringBuilder output = new StringBuilder();
            append(output, value);
            return output.toString();
        }

        private static void append(final StringBuilder output, final Object value) throws IOException {
            if (value == null) {
                output.append("null");
            } else if (value instanceof String) {
                string(output, (String) value);
            } else if (value instanceof Number || value instanceof Boolean) {
                output.append(value);
            } else if (value instanceof Map<?, ?>) {
                output.append('{');
                boolean first = true;
                for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                    if (!first) {
                        output.append(',');
                    }
                    first = false;
                    string(output, (String) entry.getKey());
                    output.append(':');
                    append(output, entry.getValue());
                }
                output.append('}');
            } else if (value instanceof Iterable<?>) {
                output.append('[');
                boolean first = true;
                for (Object item : (Iterable<?>) value) {
                    if (!first) {
                        output.append(',');
                    }
                    first = false;
                    append(output, item);
                }
                output.append(']');
            } else {
                throw new IOException("unsupported JSON value " + value.getClass());
            }
        }

        private static void string(final StringBuilder output, final String value) {
            output.append('"');
            for (int index = 0; index < value.length(); index++) {
                char character = value.charAt(index);
                switch (character) {
                case '"': output.append("\\\""); break;
                case '\\': output.append("\\\\"); break;
                case '\b': output.append("\\b"); break;
                case '\f': output.append("\\f"); break;
                case '\n': output.append("\\n"); break;
                case '\r': output.append("\\r"); break;
                case '\t': output.append("\\t"); break;
                default:
                    if (character < 0x20) {
                        output.append(String.format("\\u%04x", (int) character));
                    } else {
                        output.append(character);
                    }
                }
            }
            output.append('"');
        }
    }
}
