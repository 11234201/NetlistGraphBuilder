import { PhaseError,checkCancelled } from './protocol.js';
import { SpatialHashIndex,RouteSegmentIndex } from '../spatialIndex.js';
import { getRouteSegments,nodeBox,orthogonalSegmentIntersectsBox,collinearSegmentsOverlap,
  parallelSegmentsOverlap,near,MINIMUM_FOREIGN_WIRE_SEPARATION } from '../orthogonalRouting.js';
import {ROUTE_VALIDATION_TOLERANCE} from './policy.js';

// Shared geometry predicates remain authoritative. Perpendicular crossings are
// a soft objective; foreign collinear/visibly parallel overlaps are hard errors.
export function validateRoutes(graph,{signal}={}){
  const tolerance=ROUTE_VALIDATION_TOLERANCE,index=new SpatialHashIndex();
  const horizontalRoutes = new RouteSegmentIndex(), verticalRoutes = new RouteSegmentIndex();
  const ports=new Map(graph.nodes.flatMap((node)=>node.ports.map((port)=>[port.id,{node,port}])));
  for(const node of graph.nodes){
    if(![node.x,node.y,node.width,node.height].every(Number.isFinite))throw new PhaseError('p5','non-finite-node',[node.id]);
    index.insert(node,nodeBox(node));
  }
  const anchored=(point,id)=>{const {node,port}=ports.get(id)??{};
    return node&&Math.abs(point.x-node.x-port.x-port.anchor.x)<tolerance&&Math.abs(point.y-node.y-port.y-port.anchor.y)<tolerance;};
  const accesses=(point,next,id)=>{const {port}=ports.get(id),delta=next.x-point.x;
    return Math.abs(next.y-point.y)<tolerance&&(port.side==='EAST'?delta>=-tolerance:delta<=tolerance);};
  for(const edge of graph.edges){
    checkCancelled(signal);
    const points=edge.points;
    if(!points||points.length<2||!points.every((point)=>Number.isFinite(point.x)&&Number.isFinite(point.y)))throw new PhaseError('p5','invalid-route',[edge.id]);
    if(!anchored(points[0],edge.sourcePortId)||!anchored(points.at(-1),edge.targetPortId))throw new PhaseError('p5','detached-route',[edge.id]);
    if(!accesses(points[0],points[1],edge.sourcePortId)||!accesses(points.at(-1),points.at(-2),edge.targetPortId))throw new PhaseError('p5','wrong-port-access',[edge.id]);
    for(const segment of getRouteSegments(points,edge.physicalNetId,edge.physicalNetId)){
      const {start,end}=segment;
      if(Math.abs(start.x-end.x)>tolerance&&Math.abs(start.y-end.y)>tolerance)throw new PhaseError('p5','non-orthogonal-route',[edge.id]);
      const box={left:Math.min(start.x,end.x),right:Math.max(start.x,end.x),top:Math.min(start.y,end.y),bottom:Math.max(start.y,end.y)};
      for(const node of index.query(box)){
        if(orthogonalSegmentIntersectsBox(start,end,nodeBox(node,-tolerance)))throw new PhaseError('p5','node-intersection',[edge.id,node.id]);
      }
      const padding=MINIMUM_FOREIGN_WIRE_SEPARATION;
      const padded = {left:box.left-padding,right:box.right+padding,top:box.top-padding,bottom:box.bottom+padding};
      const overlaps = (other) => collinearSegmentsOverlap(segment,other) || parallelSegmentsOverlap(segment,other);
      // Crossings between perpendicular wires are legal. Short segments can
      // satisfy both shared orientation predicates, so index them in both.
      const horizontal = near(start.y, end.y), vertical = near(start.x, end.x);
      if (horizontal && horizontalRoutes.countForeignBox(padded,edge.physicalNetId,overlaps,1) ||
          vertical && verticalRoutes.countForeignBox(padded,edge.physicalNetId,overlaps,1)) {
        throw new PhaseError('p5','foreign-wire-overlap',[edge.id]);
      }
      Object.freeze(segment);
      if (horizontal) horizontalRoutes.push(segment);
      if (vertical) verticalRoutes.push(segment);
    }
  }
  return graph;
}
