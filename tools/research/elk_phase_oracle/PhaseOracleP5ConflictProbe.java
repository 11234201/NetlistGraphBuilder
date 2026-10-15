/* Research-only critical split mechanism probe for pinned upstream ELK; EPL-2.0 context. */
package org.eclipse.elk.alg.layered.p5edges.orthogonal;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;

import org.eclipse.elk.alg.layered.PhaseOracleTrace;
import org.eclipse.elk.alg.layered.p5edges.orthogonal.direction.BaseRoutingDirectionStrategy;
import org.eclipse.elk.alg.layered.p5edges.orthogonal.direction.RoutingDirection;

/** Produces a two-segment critical dependency cycle and observes ELK's real split path. */
public final class PhaseOracleP5ConflictProbe {
    private PhaseOracleP5ConflictProbe() { }

    public static List<Map<String, Object>> run() throws Exception {
        PhaseOracleTrace.reset();
        PhaseOracleRoutingTrace.begin();
        OrthogonalRoutingGenerator generator = new OrthogonalRoutingGenerator(
                RoutingDirection.WEST_TO_EAST, 10, null);
        Field threshold = OrthogonalRoutingGenerator.class.getDeclaredField("criticalConflictThreshold");
        threshold.setAccessible(true);
        threshold.setDouble(generator, 0.2);
        BaseRoutingDirectionStrategy direction = BaseRoutingDirectionStrategy.forRoutingDirection(
                RoutingDirection.WEST_TO_EAST);
        HyperEdgeSegment first = new HyperEdgeSegment(direction);
        first.getIncomingConnectionCoordinates().add(0.0);
        first.getOutgoingConnectionCoordinates().add(10.0);
        first.recomputeExtent();
        HyperEdgeSegment second = new HyperEdgeSegment(direction);
        second.getIncomingConnectionCoordinates().add(10.0);
        second.getOutgoingConnectionCoordinates().add(0.0);
        second.recomputeExtent();
        List<HyperEdgeSegment> segments = new ArrayList<>(List.of(first, second));

        int criticalCount = generator.createDependencyIfNecessary(first, second);
        if (criticalCount != 2) throw new AssertionError("expected two critical dependencies");
        PhaseOracleRoutingTrace.capture("critical-dependencies", 0, segments, 0.2, 0, 10, null);
        List<HyperEdgeSegmentDependency> feedback =
                HyperEdgeCycleDetector.detectCycles(segments, true, new Random(1));
        if (feedback.isEmpty()) throw new AssertionError("expected critical feedback dependency");
        for (HyperEdgeSegmentDependency dependency : feedback) {
            PhaseOracleRoutingTrace.decision("critical-cycle", dependency);
        }
        new HyperEdgeSegmentSplitter(generator).splitSegments(feedback, segments, 0.2);
        PhaseOracleRoutingTrace.capture("after-split", 0, segments, 0.2, 0, 10, null);
        if (segments.size() != 3) throw new AssertionError("expected third split segment");
        if (!HyperEdgeCycleDetector.detectCycles(segments, true, new Random(1)).isEmpty()) {
            throw new AssertionError("critical cycle survived splitting");
        }
        return PhaseOracleTrace.drain();
    }
}
