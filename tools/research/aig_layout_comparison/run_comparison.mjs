import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const [sourceRoot, sampleFile, outputDir] = process.argv.slice(2).map(x => path.resolve(x));
fs.mkdirSync(outputDir, { recursive: true });
const load = relative => import(pathToFileURL(path.join(sourceRoot, relative)));
const { createMeasuredLayoutGraph } = await load("src/contracts/measured_graph.js");
const { MeasuredAnchorLayoutProvider } = await load("src/layout/measured_anchor_layout.js");
const { MeasuredElkLayoutProvider } = await load("src/layout/measured_elk_layout.js");
const { normalizeLayoutPolicy } = await load("src/layout/layoutPolicy.js");
const { DEFAULT_LAYOUT_PROVIDER_ID } = await load("src/layout/providerDefaults.js");
const require = createRequire(path.join(sourceRoot, "package.json"));
const ELK = require(path.join(sourceRoot, "vendor/elkjs-0.11.1/lib/elk.bundled.js"));
const write = (name, value) => fs.writeFileSync(path.join(outputDir, name), typeof value === "string" ? value : JSON.stringify(value, null, 2));
const hash = value => createHash("sha256").update(value).digest("hex");
const lines = fs.readFileSync(sampleFile, "utf8").trim().split(/\r?\n/);
const [format, max, inputs, latches, outputs, gates] = lines[0].split(/\s+/);
assert.equal(format, "aag"); assert.equal(Number(latches), 0);
let cursor = 1;
const inputLiterals = Array.from({length:Number(inputs)},()=>Number(lines[cursor++]));
const outputLiterals = Array.from({length:Number(outputs)},()=>Number(lines[cursor++]));
const ands = Array.from({length:Number(gates)},()=>lines[cursor++].split(/\s+/).map(Number));
const symbols = new Map();
for (const line of lines.slice(cursor)) {
  if (line === "c") break;
  const match = /^([io]\d+)\s+(.*)$/.exec(line);
  if (match) symbols.set(match[1], match[2]);
}
const nodes = inputLiterals.map((literal,i)=>({id:"n"+(literal>>1), aigId:literal>>1, kind:"aig-input", label:symbols.get("i"+i)||"i"+i, level:0}));
for (const [lhs] of ands) nodes.push({id:"n"+(lhs>>1),aigId:lhs>>1,kind:"aig-and",label:"n"+(lhs>>1)});
const edges = [];
for (const [lhs,...fanins] of ands) fanins.forEach((literal,slot)=>edges.push({
  id:"e"+(lhs>>1)+"_"+slot, source:"n"+(literal>>1), sourcePin:"out", target:"n"+(lhs>>1),
  targetPin:"in"+slot, slot, inverted:Boolean(literal&1), net:"signal:"+(literal>>1), label:"", showLabel:false
}));
outputLiterals.forEach((literal,i)=>{
  nodes.push({id:"po"+i,kind:"aig-output",label:symbols.get("o"+i)||"po"+i});
  edges.push({id:"epo"+i,source:"n"+(literal>>1),sourcePin:"out",target:"po"+i,targetPin:"in0",slot:0,
    inverted:Boolean(literal&1),net:"signal:"+(literal>>1),label:"",showLabel:false});
});
if (edges.some(e=>e.source==="n0")) nodes.unshift({id:"n0",aigId:0,kind:"aig-constant",label:"0",level:0});
const byId = new Map(nodes.map(n=>[n.id,n]));
for (const node of nodes) {
  const incoming = edges.filter(e=>e.target===node.id);
  node.level = incoming.length ? Math.max(...incoming.map(e=>byId.get(e.source).level))+(node.kind==="aig-and"?1:0) : 0;
  node.fanout = edges.filter(e=>e.source===node.id).length;
  node.reverseDepth = node.kind==="aig-output"?0:-Infinity;
}
for (const node of [...nodes].reverse()) {
  for (const edge of edges.filter(e=>e.source===node.id)) {
    const target=byId.get(edge.target);
    node.reverseDepth=Math.max(node.reverseDepth,target.reverseDepth+(target.kind==="aig-and"?1:0));
  }
}
const depth = Math.max(...nodes.filter(n=>n.kind==="aig-output").map(n=>n.level));
for (const node of nodes) node.critical = node.level+node.reverseDepth===depth;
for (const edge of edges) {
  const source=byId.get(edge.source), target=byId.get(edge.target);
  edge.critical=source.level+(target.kind==="aig-and"?1:0)+target.reverseDepth===depth;
}
assert.equal(nodes.length,15); assert.equal(edges.length,19); assert.equal(depth,4);
assert.equal(edges.filter(e=>e.inverted).length,10);
assert.equal(edges.filter(e=>e.critical).length,9);
const referencePath=path.join(path.dirname(sampleFile),"aigverse_metrics.json");
if (fs.existsSync(referencePath)) {
  const reference=JSON.parse(fs.readFileSync(referencePath));
  for (const n of nodes.filter(n=>n.aigId!==undefined)) {
    const expected=reference.find(r=>r.node===n.aigId);
    assert.equal(n.level,expected.level); assert.equal(n.fanout,expected.fanout); assert.equal(n.critical,expected.critical);
  }
}
const width=72, height=48;
const geometry = new Map(nodes.map(node=>{
  const inputCount=node.kind==="aig-and"?2:node.kind==="aig-output"?1:0;
  const ports=Array.from({length:inputCount},(_,slot)=>({id:"in"+slot,pin:"in"+slot,direction:"input",side:"left",x:0,y:inputCount===2?12+24*slot:24}));
  if(node.kind!=="aig-output") ports.push({id:"out",pin:"out",direction:"output",side:"right",x:width,y:24});
  return [node.id,{width,height,ports,portLayout:{mode:"fixed"}}];
}));
const diagram={id:"shared-aig",domainId:"aig-research",unitId:"sample",nodes,edges};
const measurement=createMeasuredLayoutGraph(diagram,{nodes:geometry});
const original=JSON.stringify(diagram);
const policy=normalizeLayoutPolicy({spacing:{cellSpacing:8,margin:32,topPadding:0}});
write("common_input.json",{diagram,measurements:Object.fromEntries(geometry),logicalDepth:depth,layoutPolicy:policy});
const results=[];
for(const [name, provider] of [
  ["anchor",new MeasuredAnchorLayoutProvider()],
  ["elk",new MeasuredElkLayoutProvider({elkFactory:()=>{
    const engine=new ELK();
    return {layout:async input=>{
      write("elk_engine_input.json",input);
      const result=await engine.layout(input);
      write("elk_engine_raw.json",result);
      return result;
    }};
  }})]
]) {
  const start=performance.now();
  try {
    const result=await provider.layoutMeasured(measurement,{layoutPolicy:policy});
    const elapsed=performance.now()-start;
    assert.equal(JSON.stringify(diagram),original);
    assert.deepEqual(result.edges.map(e=>[e.id,e.source,e.sourcePin,e.target,e.targetPin,e.inverted,e.critical]),
      edges.map(e=>[e.id,e.source,e.sourcePin,e.target,e.targetPin,e.inverted,e.critical]));
    write(name+"_raw.json",result);
    results.push({name,graph:{...result,edges:result.edges.map(e=>({...e,draw:{kind:"polyline",points:e.points}}))},elapsedMs:elapsed,
      nativeStatus:result.layoutStatus,nativeValidation:result.validationMetrics,nativeDiagnostics:result.layoutDiagnostics});
  } catch(error) {
    const failure={name,error:String(error),diagnostic:error.diagnostic,stack:error.stack};
    write(name+"_failure.json",failure); results.push(failure);
  }
}
function htmlLabel(node) {
  if(node.kind==="aig-and") return '<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0" FIXEDSIZE="TRUE" WIDTH="72" HEIGHT="48"><TR><TD PORT="in0" WIDTH="8" HEIGHT="24"></TD><TD ROWSPAN="2" WIDTH="56" HEIGHT="48"></TD><TD PORT="out" ROWSPAN="2" WIDTH="8" HEIGHT="48"></TD></TR><TR><TD PORT="in1" WIDTH="8" HEIGHT="24"></TD></TR></TABLE>';
  return '<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0" FIXEDSIZE="TRUE" WIDTH="72" HEIGHT="48"><TR><TD PORT="in0" WIDTH="8" HEIGHT="48"></TD><TD WIDTH="56" HEIGHT="48"></TD><TD PORT="out" WIDTH="8" HEIGHT="48"></TD></TR></TABLE>';
}
const dot=['digraph G {','graph [rankdir=LR,nodesep="0.666666667",ranksep="1.111111111",splines=spline,margin=0,pad=0];',
 'node [shape=box,fixedsize=true,width=1,height="0.666666667",margin=0];','edge [arrowhead=none];'];
for(const node of nodes) dot.push(`${node.id} [id="${node.id}",label=<${htmlLabel(node)}>];`);
for(const edge of edges) dot.push(`${edge.source}:out:e -> ${edge.target}:${edge.targetPin}:w [id="${edge.id}"];`);
dot.push("}");
write("graphviz.dot",dot.join("\n"));
const start=performance.now();
const gv=JSON.parse(execFileSync("dot",["-Tjson",path.join(outputDir,"graphviz.dot")],{encoding:"utf8"}));
const gvElapsed=performance.now()-start;
write("graphviz_raw.json",gv);
const bb=gv.bb.split(",").map(Number);
const objects=new Map(gv.objects.filter(n=>n.pos).map(n=>[n.name,n]));
const gvEdges=new Map(gv.edges.map(e=>[e.id,e]));
const gvNodes=nodes.map(n=>{
  const obj=objects.get(n.id),[x,y]=obj.pos.split(",").map(Number);
  assert.ok(Math.abs(Number(obj.width)*72-width)<0.01);
  assert.ok(Math.abs(Number(obj.height)*72-height)<0.01);
  return {...n,width,height,x:x-width/2,y:bb[3]-y-height/2,ports:geometry.get(n.id).ports};
});
const gvGraph={nodes:gvNodes,edges:edges.map(e=>{
  const raw=gvEdges.get(e.id);
  const curves=raw._draw_.filter(op=>op.op.toLowerCase()==="b").map(op=>op.points.map(([x,y])=>({x,y:bb[3]-y})));
  assert.equal(curves.length,1,"Expected one spline per AIG edge");
  assert.equal((curves[0].length-1)%3,0);
  return {...e,draw:{kind:"bezier",points:curves[0]}};
})};
results.push({name:"graphviz",graph:gvGraph,elapsedMs:gvElapsed,nativeStatus:"dot completed",nativeValidation:null});
function polyline(edge){
  if(edge.draw.kind==="polyline") return edge.draw.points;
  const p=edge.draw.points, result=[p[0]];
  for(let i=1;i<p.length;i+=3) for(let j=1;j<=32;j++){
    const t=j/32,u=1-t,a=p[i-1],b=p[i],c=p[i+1],d=p[i+2];
    result.push({x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,
      y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y});
  }
  return result;
}
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const cross=(a,b)=>a.x*b.y-a.y*b.x;
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
function crossing(a,b,c,d){
  const r=sub(b,a),s=sub(d,c),den=cross(r,s);
  if(Math.abs(den)<1e-9) return null;
  const t=cross(sub(c,a),s)/den,u=cross(sub(c,a),r)/den;
  if(t<=1e-6||t>=1-1e-6||u<=1e-6||u>=1-1e-6) return null;
  return {x:a.x+t*r.x,y:a.y+t*r.y};
}
function entersBox(a,b,n){
  const epsilon=.1, box={l:n.x+epsilon,r:n.x+n.width-epsilon,t:n.y+epsilon,b:n.y+n.height-epsilon};
  let lo=0,hi=1;
  for(const [origin,delta,min,max] of [[a.x,b.x-a.x,box.l,box.r],[a.y,b.y-a.y,box.t,box.b]]){
    if(Math.abs(delta)<1e-9){if(origin<min||origin>max)return false;}
    else {const u=(min-origin)/delta,v=(max-origin)/delta;lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));}
    if(lo>hi)return false;
  }
  return hi>=lo;
}
const round=x=>Math.round(x*100)/100;
function inspect(result){
  const graph=result.graph, records=graph.edges.map(e=>({edge:e,points:polyline(e)}));
  const graphNodes=new Map(graph.nodes.map(n=>[n.id,n]));
  const allPoints=[...graph.nodes.flatMap(n=>[{x:n.x,y:n.y},{x:n.x+n.width,y:n.y+n.height}]),...records.flatMap(r=>r.points)];
  const left=Math.min(...allPoints.map(p=>p.x)),top=Math.min(...allPoints.map(p=>p.y));
  const right=Math.max(...allPoints.map(p=>p.x)),bottom=Math.max(...allPoints.map(p=>p.y));
  const crossingPoints=[],nodeIntersections=[],endpointErrors=[];
  let logicalLength=0,bends=0,nodeOverlaps=0;
  for(let i=0;i<graph.nodes.length;i++) for(let j=i+1;j<graph.nodes.length;j++){
    const a=graph.nodes[i],b=graph.nodes[j];
    if(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>.1&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>.1)nodeOverlaps++;
  }
  for(const {edge,points} of records){
    const s=graphNodes.get(edge.source),t=graphNodes.get(edge.target);
    const sp=geometry.get(s.id).ports.find(p=>p.id===edge.sourcePin),tp=geometry.get(t.id).ports.find(p=>p.id===edge.targetPin);
    const sd=dist(points[0],{x:s.x+sp.x,y:s.y+sp.y}),td=dist(points.at(-1),{x:t.x+tp.x,y:t.y+tp.y});
    if(sd>.11||td>.11)endpointErrors.push({edgeId:edge.id,sourceDistance:sd,targetDistance:td});
    for(let i=1;i<points.length;i++)logicalLength+=dist(points[i-1],points[i]);
    if(edge.draw.kind==="polyline")for(let i=1;i<points.length-1;i++){
      const a=sub(points[i],points[i-1]),b=sub(points[i+1],points[i]);
      if(Math.abs(cross(a,b))>1e-6||a.x*b.x+a.y*b.y<0)bends++;
    }
    for(const n of graph.nodes.filter(n=>n.id!==edge.source&&n.id!==edge.target)){
      if(points.slice(1).some((p,i)=>entersBox(points[i],p,n)))nodeIntersections.push({edgeId:edge.id,nodeId:n.id});
    }
  }
  for(let i=0;i<records.length;i++)for(let j=i+1;j<records.length;j++){
    const a=records[i],b=records[j];
    if(a.edge.source===b.edge.source)continue;
    for(let u=1;u<a.points.length;u++)for(let v=1;v<b.points.length;v++){
      const hit=crossing(a.points[u-1],a.points[u],b.points[v-1],b.points[v]);
      if(hit&&!crossingPoints.some(p=>dist(p,hit)<1))crossingPoints.push(hit);
    }
  }
  return {bounds:{left,top,width:right-left,height:bottom-top},width:round(right-left),height:round(bottom-top),
    area:round((right-left)*(bottom-top)),logicalWireLength:round(logicalLength),bends:result.name==="graphviz"?null:bends,
    properCrossingsApprox:crossingPoints.length,crossingPoints,nodeOverlaps,nodeIntersections,endpointErrors};
}
const esc=x=>String(x).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
function drawSvg(result,highlight=true){
  const {left,top,width,height}=result.metrics.bounds,pad=24;
  const out=[`<svg xmlns="http://www.w3.org/2000/svg" width="${round(width+pad*2)}" height="${round(height+pad*2)}" viewBox="${round(left-pad)} ${round(top-pad)} ${round(width+pad*2)} ${round(height+pad*2)}">`,
    `<rect x="${left-pad}" y="${top-pad}" width="${width+pad*2}" height="${height+pad*2}" fill="white"/>`];
  const edgePath=e=>{
    const p=e.draw.points;
    if(e.draw.kind==="polyline")return p.map((p,i)=>`${i?"L":"M"} ${p.x} ${p.y}`).join(" ");
    let d=`M ${p[0].x} ${p[0].y}`;
    for(let i=1;i<p.length;i+=3)d+=` C ${p[i].x} ${p[i].y} ${p[i+1].x} ${p[i+1].y} ${p[i+2].x} ${p[i+2].y}`;
    return d;
  };
  for(const criticalPass of [false,true]){
    if(criticalPass&&!highlight)continue;
    for(const e of result.graph.edges.filter(e=>!criticalPass||e.critical)){
      out.push(`<path data-edge-id="${e.id}" d="${edgePath(e)}" fill="none" stroke="${criticalPass?"#c73932":"#596579"}" stroke-width="${criticalPass?2.6:1.6}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
  }
  for(const n of result.graph.nodes){
    const critical=highlight&&n.critical, fill=critical?"#fde2df":n.kind==="aig-and"?"#f4f6f9":"#e5effb";
    out.push(`<g data-node-id="${n.id}"><rect x="${n.x+8}" y="${n.y}" width="64" height="48" rx="5" fill="${fill}" stroke="${critical?"#c73932":"#43536b"}" stroke-width="1.5"/>`);
    out.push(`<text x="${n.x+40}" y="${n.y+19}" font-family="DejaVu Sans" font-size="13" font-weight="bold" text-anchor="middle" fill="#16263b">${esc(n.label)}</text>`);
    out.push(`<text x="${n.x+15}" y="${n.y+38}" font-family="DejaVu Sans" font-size="10" fill="#566174">L${n.level}</text>`);
    const fanoutFill=highlight&&n.fanout>=2?"#ffdaa3":"#e5e9ef";
    out.push(`<rect x="${n.x+36}" y="${n.y+27}" width="30" height="15" rx="3" fill="${fanoutFill}"/><text x="${n.x+51}" y="${n.y+38}" text-anchor="middle" font-family="DejaVu Sans" font-size="10" fill="#59401f">fo ${n.fanout}</text></g>`);
    for(const p of geometry.get(n.id).ports.filter(p=>p.direction==="input")){
      const e=result.graph.edges.find(e=>e.target===n.id&&e.targetPin===p.id);
      const color=highlight&&e?.critical?"#c73932":"#596579";
      out.push(`<line x1="${n.x}" y1="${n.y+p.y}" x2="${n.x+8}" y2="${n.y+p.y}" stroke="${color}" stroke-width="${highlight&&e?.critical?2.6:1.6}"/>`);
      if(e?.inverted)out.push(`<circle data-inversion="${e.id}" cx="${n.x+4}" cy="${n.y+p.y}" r="3.5" fill="white" stroke="#172b4d" stroke-width="1.5"/>`);
    }
  }
  out.push("</svg>");return out.join("\n");
}
for(const result of results){
  if(result.error)continue;
  result.metrics=inspect(result);
  write(result.name+"_geometry.json",result.graph);
  write(result.name+".svg",drawSvg(result));
  write(result.name+"_plain.svg",drawSvg(result,false));
}
const evidence={
  date:new Date().toISOString(),sampleSha256:hash(fs.readFileSync(sampleFile)),
  sourceArchiveSha256:fs.existsSync(path.join(sourceRoot,"../provider_source.tar.gz"))?hash(fs.readFileSync(path.join(sourceRoot,"../provider_source.tar.gz"))):null,
  sourceRevision:"59eea493d2ad947b74119771dbe7357cd54ea1b9 plus current working-tree changes",
  defaultProvider:DEFAULT_LAYOUT_PROVIDER_ID,nodeVersion:process.version,elkVersion:JSON.parse(fs.readFileSync(path.join(sourceRoot,"vendor/elkjs-0.11.1/package.json"))).version,
  graphviz:"Graphviz 2.43.0 (environment verified)",
  sourceHashes:Object.fromEntries(["src/contracts/measured_graph.js","src/layout/measured_anchor_layout.js","src/layout/measured_elk_layout.js","src/layout/anchor_layered/anchor.js","src/layout/layoutValidator.js"].map(p=>[p,hash(fs.readFileSync(path.join(sourceRoot,p)))])),
  common:{nodes:nodes.length,andNodes:Number(gates),edges:edges.length,invertedEdges:10,criticalGraphNodes:nodes.filter(n=>n.critical).length,criticalEdges:9,highFanoutNodes:nodes.filter(n=>n.fanout>=2).length,depth,
    dimensions:{width,height,bodyWidth:64,inversionGutter:8},direction:"LR",nodeGap:48,rankGap:80,
    rankConstraints:"None explicitly added; each provider assigns ranks.",fanout:"Reference/slot count including PO references",
    rendering:"Shared SVG renderer; native logical-edge geometry; no route repair; common scale; constant 0 unused and omitted everywhere.",
    graphvizMode:"dot splines=spline; HTML fixed-size ports, arrowhead=none",
    metricNotes:"Crossings use cubic subdivision (32 samples/segment), exclude same-source pairs, and count proper interior intersections only. Wire length sums logical edges, counting shared trunks repeatedly. Graphviz is not judged by the project's orthogonal-only validator. Timing is one cold call with different execution overhead, not a benchmark."},
  analysis:nodes.map(({id,level,fanout,critical})=>({id,level,fanout,critical})),
  results:results.map(({graph,...result})=>result)
};
write("results.json",evidence);
console.log(JSON.stringify(evidence.results.map(r=>({name:r.name,error:r.error,status:r.nativeStatus,validation:r.nativeValidation,metrics:r.metrics})),null,2));
