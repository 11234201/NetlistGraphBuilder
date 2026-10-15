// Research-only viewport crop of saved completed geometry. Never an acceptance
// metric or a routed graph: segment ends are clipped only for visual export.
import {readFile,writeFile} from 'node:fs/promises';
import {renderSchematicSvg} from '../../../src/domains/netlist/netlist_scene.js';
import {createStandaloneSvg} from '../../../src/render/svgExport.js';
const [input,output,focusId,widthText='1800',heightText='1400']=process.argv.slice(2);
const graph=JSON.parse(await readFile(input,'utf8'));
const focus=graph.nodes.find((node)=>node.id===focusId);
if(!focus)throw new Error(`Missing visual focus ${focusId}; declared roots: ${JSON.stringify(graph.nodes.filter((node)=>node.isFocusedRoot||node.label==='clk').map(({id,label,kind})=>({id,label,kind})))}`);
const width=Number(widthText),height=Number(heightText);
if(!(width>0&&height>0))throw new Error('Invalid viewport');
const x=focus.x+focus.width/2-width/2,y=focus.y+focus.height/2-height/2;
const inside=(point)=>point.x>=x&&point.x<=x+width&&point.y>=y&&point.y<=y+height;
const clampPoint=(point)=>({x:Math.max(x,Math.min(x+width,point.x)),y:Math.max(y,Math.min(y+height,point.y))});
const segmentsInWindow=(segments)=>segments.filter(({start,end})=>
  Math.max(start.x,end.x)>=x&&Math.min(start.x,end.x)<=x+width&&
  Math.max(start.y,end.y)>=y&&Math.min(start.y,end.y)<=y+height)
  .map((segment)=>({...segment,start:clampPoint(segment.start),end:clampPoint(segment.end)}));
const nodes=graph.nodes.filter((node)=>node.x+node.width>=x&&node.x<=x+width&&node.y+node.height>=y&&node.y<=y+height);
const wireRoutes=graph.wireRoutes.map((route)=>({...route,segments:segmentsInWindow(route.segments),
  junctions:(route.junctions??[]).filter(inside),showLabel:route.showLabel&&inside(route.labelPoint??{x:NaN,y:NaN})}))
  .filter((route)=>route.segments.length);
const markup=createStandaloneSvg(renderSchematicSvg({...graph,nodes,edges:[],wireRoutes,width,height}));
await writeFile(output,markup.replace(/viewBox="[^"]*"/,`viewBox="${x} ${y} ${width} ${height}"`));
console.log(JSON.stringify({input,output,focusId,viewport:{x,y,width,height},nodes:nodes.length}));
