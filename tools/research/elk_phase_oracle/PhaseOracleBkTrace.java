/* Research-only BK decision capture for pinned upstream ELK; EPL-2.0 context. */
package org.eclipse.elk.alg.layered.p4nodes.bk;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.eclipse.elk.alg.layered.PhaseOracleTrace;
import org.eclipse.elk.alg.layered.graph.LEdge;
import org.eclipse.elk.alg.layered.graph.LNode;
import org.eclipse.elk.alg.layered.graph.LPort;

/** Reads candidate state before BKNodePlacer cleans up its arrays. */
public final class PhaseOracleBkTrace {
    private static final ThreadLocal<Map<BKAlignedLayout, Boolean>> FEASIBLE =
            ThreadLocal.withInitial(IdentityHashMap::new);
    private static final ThreadLocal<List<Map<String, Object>>> DECISIONS =
            ThreadLocal.withInitial(ArrayList::new);

    private PhaseOracleBkTrace() { }

    public static void resetDecisions() { DECISIONS.get().clear(); }

    public static List<Map<String, Object>> drainDecisions() {
        List<Map<String, Object>> result = new ArrayList<>(DECISIONS.get());
        DECISIONS.get().clear();
        return result;
    }

    private static Object edge(final LEdge value) {
        if (value == null) return null;
        Map<String, Object> result = new LinkedHashMap<>();
        LPort source = value.getSource();
        LPort target = value.getTarget();
        result.put("sourceIndex", source.getNode().id);
        result.put("sourcePortOrder", source.getNode().getPorts().indexOf(source));
        result.put("targetIndex", target.getNode().id);
        result.put("targetPortOrder", target.getNode().getPorts().indexOf(target));
        return result;
    }

    public static void decision(final BKAlignedLayout bal, final String event, final LNode free,
            final boolean isRoot, final LEdge selected, final Boolean hasEdges, final Double amount) {
        Map<String, Object> record = new LinkedHashMap<>();
        LNode block = bal.root[free.id];
        record.put("direction", String.valueOf(bal));
        record.put("event", event);
        record.put("freeIndex", free.id);
        record.put("blockIndex", block.id);
        record.put("isRoot", isRoot);
        record.put("edge", edge(selected));
        record.put("hasEdges", hasEdges);
        record.put("amount", amount == null ? null : number(amount));
        record.put("blockY", bal.y[block.id] == null ? null : number(bal.y[block.id]));
        record.put("straightened", bal.su[block.id]);
        DECISIONS.get().add(record);
    }

    public static void threshold(final BKAlignedLayout bal, final LNode block, final LNode current,
            final double previous, final int position) {
        Map<String, Object> record = new LinkedHashMap<>();
        int neighborIndex = position + (bal.vdir == BKAlignedLayout.VDirection.DOWN ? -1 : 1);
        List<LNode> layer = current.getLayer().getNodes();
        record.put("direction", String.valueOf(bal));
        record.put("event", "threshold-call");
        record.put("freeIndex", current.id);
        record.put("blockIndex", block.id);
        record.put("adjacentIndex", neighborIndex < 0 || neighborIndex >= layer.size() ? null
                : layer.get(neighborIndex).id);
        record.put("previousThreshold", number(previous));
        DECISIONS.get().add(record);
    }

    public static void feasible(final BKAlignedLayout layout, final boolean result) {
        FEASIBLE.get().put(layout, result);
    }

    private static String node(final LNode value) {
        if (value == null) return null;
        return value.id + ":" + value.getDesignation();
    }

    private static List<String> nodes(final LNode[] values) {
        List<String> result = new ArrayList<>();
        for (LNode value : values) result.add(node(value));
        return result;
    }

    private static List<Object> numbers(final Double[] values) {
        List<Object> result = new ArrayList<>();
        for (Double value : values) {
            if (value == null) result.add(null);
            else if (value.isNaN()) result.add("NaN");
            else if (value == Double.POSITIVE_INFINITY) result.add("Infinity");
            else if (value == Double.NEGATIVE_INFINITY) result.add("-Infinity");
            else result.add(value);
        }
        return result;
    }

    private static Object number(final double value) {
        if (Double.isNaN(value)) return "NaN";
        if (value == Double.POSITIVE_INFINITY) return "Infinity";
        if (value == Double.NEGATIVE_INFINITY) return "-Infinity";
        return value;
    }

    private static Map<String, Object> layout(final BKAlignedLayout value) {
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("direction", String.valueOf(value));
        record.put("vertical", value.vdir == null ? null : value.vdir.name());
        record.put("horizontal", value.hdir == null ? null : value.hdir.name());
        record.put("feasible", FEASIBLE.get().get(value));
        record.put("size", value.vdir == null ? null : number(value.layoutSize()));
        record.put("root", nodes(value.root));
        record.put("align", nodes(value.align));
        record.put("sink", nodes(value.sink));
        record.put("blockSize", numbers(value.blockSize));
        record.put("innerShift", numbers(value.innerShift));
        record.put("shift", numbers(value.shift));
        record.put("y", numbers(value.y));
        record.put("straightened", Arrays.asList(value.su.clone()));
        record.put("dummyOnly", Arrays.asList(value.od.clone()));
        return record;
    }

    public static void capture(final Set<LEdge> markedEdges,
            final List<BKAlignedLayout> candidates, final BKAlignedLayout selected) {
        List<String> conflicts = markedEdges.stream()
                .map(edge -> String.valueOf(edge.getDesignation()))
                .sorted(Comparator.naturalOrder()).toList();
        List<Map<String, Object>> layouts = new ArrayList<>();
        for (BKAlignedLayout candidate : candidates) layouts.add(layout(candidate));
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("phase", "p4");
        record.put("event", "bk-candidates");
        record.put("markedType1Edges", conflicts);
        record.put("candidates", layouts);
        record.put("selected", layout(selected));
        PhaseOracleTrace.record(record);
        FEASIBLE.get().clear();
    }
}
