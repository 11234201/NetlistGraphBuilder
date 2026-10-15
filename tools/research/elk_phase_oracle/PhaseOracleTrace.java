/* Research-only instrumentation for pinned upstream ELK; EPL-2.0 context. */
package org.eclipse.elk.alg.layered;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.eclipse.elk.alg.layered.graph.LNode;
import org.eclipse.elk.alg.layered.graph.LPort;
import org.eclipse.elk.alg.layered.p3order.GraphInfoHolder;
import org.eclipse.elk.alg.common.networksimplex.NEdge;
import org.eclipse.elk.alg.common.networksimplex.NGraph;
import org.eclipse.elk.alg.common.networksimplex.NNode;

/** Captures phase-local decisions without affecting their inputs or return values. */
public final class PhaseOracleTrace {
    private static final ThreadLocal<List<Map<String, Object>>> EVENTS =
            ThreadLocal.withInitial(ArrayList::new);
    private static final ThreadLocal<Map<Object, String>> IDS =
            ThreadLocal.withInitial(IdentityHashMap::new);

    private PhaseOracleTrace() { }

    public static void reset() {
        EVENTS.get().clear();
        IDS.get().clear();
    }

    public static List<Map<String, Object>> drain() {
        List<Map<String, Object>> events = new ArrayList<>(EVENTS.get());
        EVENTS.get().clear();
        return events;
    }

    public static void record(final Map<String, Object> event) {
        EVENTS.get().add(event);
    }

    public static void p2(final NGraph graph, final int iterationLimit) {
        List<Map<String, Object>> nodes = new ArrayList<>();
        List<Map<String, Object>> edges = new ArrayList<>();
        double weightedSpan = 0;
        for (NNode node : graph.nodes) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", node.origin instanceof LNode ? ((LNode) node.origin).getDesignation() : node.id);
            item.put("rank", node.layer);
            nodes.add(item);
            for (NEdge edge : node.getOutgoingEdges()) {
                int span = edge.target.layer - edge.source.layer;
                weightedSpan += edge.weight * span;
                Map<String, Object> edgeItem = new LinkedHashMap<>();
                edgeItem.put("source", edge.source.origin instanceof LNode
                        ? ((LNode) edge.source.origin).getDesignation() : edge.source.id);
                edgeItem.put("target", edge.target.origin instanceof LNode
                        ? ((LNode) edge.target.origin).getDesignation() : edge.target.id);
                edgeItem.put("weight", edge.weight);
                edgeItem.put("minimumSpan", edge.delta);
                edgeItem.put("actualSpan", span);
                edges.add(edgeItem);
            }
        }
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("phase", "p2");
        event.put("event", "network-simplex-result");
        event.put("iterationLimit", iterationLimit);
        event.put("objectiveWeightedSpan", weightedSpan);
        event.put("nodes", nodes);
        event.put("edges", edges);
        record(event);
    }

    public static void p5Width(final int sourceLayerIndex, final int slotCount,
            final double xBefore, final double xAfter, final double nodeNodeSpacing,
            final double edgeNodeSpacing, final double edgeEdgeSpacing,
            final boolean leftExternal, final boolean rightExternal) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("phase", "p5");
        event.put("event", "boundary-width");
        event.put("sourceLayerIndex", sourceLayerIndex);
        event.put("slotCount", slotCount);
        event.put("xBefore", xBefore);
        event.put("xAfter", xAfter);
        event.put("width", xAfter - xBefore);
        event.put("nodeNodeSpacing", nodeNodeSpacing);
        event.put("edgeNodeSpacing", edgeNodeSpacing);
        event.put("edgeEdgeSpacing", edgeEdgeSpacing);
        event.put("leftExternal", leftExternal);
        event.put("rightExternal", rightExternal);
        record(event);
    }

    private static String id(final Object element, final String prefix, final String designation) {
        if (designation != null && !designation.isBlank()) {
            return designation;
        }
        return IDS.get().computeIfAbsent(element, ignored -> prefix + IDS.get().size());
    }

    public static void p3(final String event, final GraphInfoHolder graph,
            final Boolean forward, final double crossings, final boolean retained) {
        List<Map<String, Object>> layers = new ArrayList<>();
        for (LNode[] layer : graph.currentNodeOrder()) {
            List<Map<String, Object>> nodes = new ArrayList<>();
            for (LNode node : layer) {
                List<String> ports = new ArrayList<>();
                for (LPort port : node.getPorts()) {
                    ports.add(id(port, "port:", port.getDesignation()));
                }
                Map<String, Object> nodeRecord = new LinkedHashMap<>();
                nodeRecord.put("id", id(node, "node:", node.getDesignation()));
                nodeRecord.put("kind", node.getType().name());
                nodeRecord.put("portOrder", ports);
                nodes.add(nodeRecord);
            }
            Map<String, Object> layerRecord = new LinkedHashMap<>();
            layerRecord.put("nodes", nodes);
            layers.add(layerRecord);
        }
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("phase", "p3");
        record.put("event", event);
        record.put("forward", forward);
        record.put("crossings", crossings);
        record.put("retained", retained);
        record.put("layers", layers);
        EVENTS.get().add(record);
    }
}
