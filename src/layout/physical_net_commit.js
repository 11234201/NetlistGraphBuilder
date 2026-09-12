import { validateLayoutGraph } from "./layoutValidator.js";
import { getPhysicalNetKey, buildPhysicalWireRoute } from "./wireRoutes.js";

/**
 * Validate one complete physical net as an atomic routing unit. Callers must
 * not reserve or publish any branch until this boundary returns `routed`.
 */
export function validatePhysicalNetCommit(edges = [], nodes = [], options = {}) {
  const sortedEdges = [...edges].sort((left, right) =>
    String(left?.id || "").localeCompare(String(right?.id || "")));
  const netGroupKeys = [...new Set(sortedEdges.map(getPhysicalNetKey))];
  if (sortedEdges.length === 0 || netGroupKeys.length !== 1) {
    return {
      status: "unroutable",
      wireRoute: null,
      diagnostics: [{
        code: sortedEdges.length === 0
          ? "physical-net-empty"
          : "physical-net-owner-mismatch",
        netGroupKeys
      }]
    };
  }

  const wireRoute = buildPhysicalWireRoute(netGroupKeys[0], sortedEdges);
  const diagnostics = validateLayoutGraph({
    nodes,
    edges: sortedEdges,
    wireRoutes: [wireRoute],
    width: options.width,
    height: options.height
  }, {
    checkObstacles: options.checkObstacles !== false,
    checkOverlaps: true,
    checkBounds: options.checkBounds === true,
    maxViolations: options.maxViolations ?? 64
  });
  return {
    status: diagnostics.length === 0 ? "routed" : "unroutable",
    wireRoute,
    diagnostics
  };
}
