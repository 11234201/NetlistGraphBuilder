import { snapNodePosition } from "../layout/snap.js";
import { createLatestFrameScheduler } from "./frameScheduler.js";
import { getDraggedNodePosition, sameNodePosition } from "./nodeDrag.js";
import { createNodeDragPreview } from "./nodeDragPreview.js";
import { startPointerSession } from "./pointerSession.js";

export function startCanvasNodeDrag({
  event,
  target,
  mount,
  graph,
  node,
  getPreviousPosition,
  updatePosition,
  onPreview,
  onCommit
}) {
  if (!event || !target || !mount || !graph || !node || typeof updatePosition !== "function") {
    return false;
  }
  const startPoint = clientPointToContent(mount, event);
  if (!startPoint) return false;

  event.preventDefault?.();
  const startPosition = { x: node.x, y: node.y };
  const preview = createNodeDragPreview(mount, graph, node.id, startPosition);
  let moved = false;
  let latestPosition = startPosition;
  let latestSnap = null;
  const frames = createLatestFrameScheduler((pointer) => {
    const point = clientPointToContent(mount, pointer);
    if (!point) return;
    const candidate = getDraggedNodePosition(startPosition, startPoint, point);
    const snapResult = snapNodePosition(graph, node.id, candidate);
    const nextPosition = normalizePosition(snapResult.position);
    if (sameNodePosition(getPreviousPosition?.(), nextPosition)) return;
    moved = true;
    latestPosition = nextPosition;
    latestSnap = snapResult.snap || null;
    updatePosition(nextPosition);
    preview.update(nextPosition);
    onPreview?.({ position: nextPosition, snap: latestSnap });
  });

  startPointerSession({
    target,
    pointerId: event.pointerId,
    className: "is-node-dragging",
    onMove: (moveEvent) => frames.schedule(clientPoint(moveEvent)),
    onEnd: (endEvent) => {
      frames.flush();
      if (!moved) {
        preview.clear();
        return;
      }
      onCommit?.({
        position: latestPosition,
        snap: latestSnap,
        preview,
        cancelled: endEvent?.type === "pointercancel"
      });
    }
  });
  return true;
}

function clientPointToContent(mount, event) {
  const svg = mount.querySelector?.("svg");
  const matrix = mount.querySelector?.("#schematicContent")?.getScreenCTM?.();
  if (!svg || !matrix) return null;
  const point = svg.createSVGPoint();
  const client = clientPoint(event);
  point.x = client.x;
  point.y = client.y;
  return point.matrixTransform(matrix.inverse());
}

function clientPoint(event) {
  const x = Number(event?.clientX);
  const y = Number(event?.clientY);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    clientX: Number.isFinite(x) ? x : 0,
    clientY: Number.isFinite(y) ? y : 0
  };
}

function normalizePosition(position) {
  return {
    x: round(Math.max(16, Number(position?.x) || 0)),
    y: round(Math.max(16, Number(position?.y) || 0))
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
