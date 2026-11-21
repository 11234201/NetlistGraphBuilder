import { clientPointToViewBox, getAdaptiveMaxScale, getPannedTransform } from "../ui/viewport.js";
import { invalid, number } from "./remote_object_queries.js";

export function runViewportCommand(job, viewport, mount, commit, fit) {
  const svg = mount?.querySelector("svg");
  const rect = svg?.getBoundingClientRect(), box = svg?.viewBox?.baseVal;
  if (job.name === "viewport fit") { fit(); return; }
  if (job.name === "viewport get") return { ...viewport, width:rect?.width || 0,height:rect?.height || 0,
    viewBox:box ? {x:box.x,y:box.y,width:box.width,height:box.height} : null };
  if (!box || !rect?.width || !rect.height) throw invalid("VIEW_UNAVAILABLE","A mounted canvas is required");
  let next;
  if (job.name === "viewport pan") {
    next = getPannedTransform(viewport,{x:0,y:0},{x:number(job.args[0],"dx"),y:number(job.args[1],"dy")},box,rect);
  } else {
    const factor = number(job.args[0],"zoom factor");
    if (factor <= 0) throw invalid("INVALID_ARGUMENT","Zoom factor must be positive");
    const [x,y] = job.opts.at || [rect.width / 2, rect.height / 2];
    const point = clientPointToViewBox({x:rect.left + number(x,"anchor x"),y:rect.top + number(y,"anchor y")},rect,box);
    const scale = Math.max(0.25, Math.min(getAdaptiveMaxScale(box.width,rect.width,box.height,rect.height), viewport.scale * factor));
    const ratio = scale / viewport.scale;
    next = {scale,x:point.x - (point.x - viewport.x) * ratio,y:point.y - (point.y - viewport.y) * ratio};
  }
  commit(next);
  return next;
}
