import {readFile,writeFile} from 'node:fs/promises';
const [output,...inputs]=process.argv.slice(2);
if(!output||inputs.length!==3)throw Error('usage: export_cohesion_visual_nodes.mjs <output.json> <elk.graph.json> <baseline.graph.json> <trial.graph.json>');
const data={};
for(const [index,name] of ['elk','baseline','trial'].entries()){
  const graph=JSON.parse(await readFile(inputs[index],'utf8'));
  data[name]={width:graph.width,height:graph.height,nodes:graph.nodes.map(({id,x,y,width,height})=>({id,x,y,width,height}))};
}
await writeFile(output,JSON.stringify(data));
