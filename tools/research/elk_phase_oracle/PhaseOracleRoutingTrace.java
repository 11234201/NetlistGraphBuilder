/* Research-only routing decision capture for pinned upstream ELK; EPL-2.0 context. */
package org.eclipse.elk.alg.layered.p5edges.orthogonal;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.eclipse.elk.alg.layered.PhaseOracleTrace;
import org.eclipse.elk.alg.layered.graph.LPort;

/** Reads live hyperedge segments at each orthogonal-routing decision boundary. */
public final class PhaseOracleRoutingTrace {
    private static final ThreadLocal<Map<HyperEdgeSegment, String>> IDS =
            ThreadLocal.withInitial(IdentityHashMap::new);

    private PhaseOracleRoutingTrace() { }

    public static void begin() {
        IDS.get().clear();
    }

    private static String id(final HyperEdgeSegment segment) {
        if (segment == null) return null;
        return IDS.get().computeIfAbsent(segment, ignored -> "segment:" + IDS.get().size());
    }

    private static Object number(final double value) {
        if (Double.isNaN(value)) return "NaN";
        if (value == Double.POSITIVE_INFINITY) return "Infinity";
        if (value == Double.NEGATIVE_INFINITY) return "-Infinity";
        return value;
    }

    private static List<Object> numbers(final List<Double> values) {
        List<Object> result = new ArrayList<>();
        for (Double value : values) result.add(number(value));
        return result;
    }

    private static String port(final LPort port) {
        return port.getNode().getDesignation() + ":" + port.getDesignation();
    }

    private static Map<String, Object> dependency(final HyperEdgeSegmentDependency value) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("source", id(value.getSource()));
        result.put("target", id(value.getTarget()));
        result.put("type", value.getType().name());
        result.put("weight", value.getWeight());
        return result;
    }

    public static void decision(final String action, final HyperEdgeSegmentDependency value) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("phase", "p5");
        result.put("event", "dependency-decision");
        result.put("action", action);
        result.put("dependency", dependency(value));
        PhaseOracleTrace.record(result);
    }

    public static void split(final HyperEdgeSegment segment, final double position) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("phase", "p5");
        result.put("event", "segment-split");
        result.put("segment", id(segment));
        result.put("causedBy", id(segment.getSplitBy()));
        result.put("position", number(position));
        PhaseOracleTrace.record(result);
    }

    public static void capture(final String stage, final int sourceLayerIndex,
            final List<HyperEdgeSegment> segments, final double criticalThreshold,
            final double startPos, final double edgeSpacing, final Integer slotCount) {
        // Allocate IDs in source-list order before traversing dependencies.
        for (HyperEdgeSegment segment : segments) id(segment);
        List<Map<String, Object>> segmentRecords = new ArrayList<>();
        List<Map<String, Object>> dependencies = new ArrayList<>();
        for (HyperEdgeSegment segment : segments) {
            Map<String, Object> record = new LinkedHashMap<>();
            record.put("id", id(segment));
            record.put("ports", segment.getPorts().stream().map(PhaseOracleRoutingTrace::port).toList());
            record.put("start", number(segment.getStartCoordinate()));
            record.put("end", number(segment.getEndCoordinate()));
            record.put("incoming", numbers(segment.getIncomingConnectionCoordinates()));
            record.put("outgoing", numbers(segment.getOutgoingConnectionCoordinates()));
            record.put("routingSlot", segment.getRoutingSlot());
            record.put("splitPartner", id(segment.getSplitPartner()));
            record.put("splitBy", id(segment.getSplitBy()));
            segmentRecords.add(record);
            for (HyperEdgeSegmentDependency dependency : segment.getOutgoingSegmentDependencies()) {
                dependencies.add(dependency(dependency));
            }
        }
        dependencies.sort(Comparator.comparing((Map<String, Object> item) -> (String) item.get("source"))
                .thenComparing(item -> (String) item.get("target"))
                .thenComparing(item -> (String) item.get("type")));
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("phase", "p5");
        event.put("event", "boundary-state");
        event.put("stage", stage);
        event.put("sourceLayerIndex", sourceLayerIndex);
        event.put("criticalThreshold", number(criticalThreshold));
        event.put("startPosition", number(startPos));
        event.put("edgeSpacing", number(edgeSpacing));
        event.put("slotCount", slotCount);
        event.put("segments", segmentRecords);
        event.put("dependencies", dependencies);
        PhaseOracleTrace.record(event);
    }
}
