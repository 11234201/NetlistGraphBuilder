// Display-only review of saved complete results; never recomputes layout or changes geometry.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {resolve,join} from 'node:path';
import {sha256} from './quality_baseline.mjs';

const [input,output]=process.argv.slice(2).map(value=>resolve(value));
if(!input||!output)throw Error('usage: export_product_review.mjs <complete-products> <review-directory>');
await mkdir(output,{recursive:true});
const cases=['mapped_small_sop001','mapped_medium_eq006','mapped_large_dp002'];
const index=[];
for(const id of cases){
  const report=JSON.parse(await readFile(join(input,`${id}.report.json`),'utf8'));
  const graphs=await Promise.all(['elk-layered','native-layered'].map(async provider=>
    JSON.parse(await readFile(join(input,`${id}.${provider}.graph.json`),'utf8'))));
  const native=graphs[1],ordered=[...native.nodes].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const counts=new Map(ordered.map(node=>[node.id,0]));
  for(const edge of native.edges)counts.set(edge.source,(counts.get(edge.source)||0)+1);
  // Predeclared topology-only anchors, not selected by favourable rendered coordinates.
  const anchors=[ordered.find(node=>node.kind==='output'),
    [...ordered].sort((a,b)=>counts.get(b.id)-counts.get(a.id)||(a.id<b.id?-1:a.id>b.id?1:0))[0],
    ordered.filter(node=>node.kind==='cell')[Math.floor(ordered.filter(node=>node.kind==='cell').length/2)]]
    .filter(Boolean).map(node=>node.id).filter((id,i,ids)=>ids.indexOf(id)===i);
  const row={id,report,common:{width:Math.max(...graphs.map(g=>g.width)),height:Math.max(...graphs.map(g=>g.height))},
    anchors:anchors.map(nodeId=>({nodeId,frames:graphs.map(graph=>{
      const node=graph.nodes.find(n=>n.id===nodeId);if(!node)throw Error(`anchor absent: ${nodeId}`);
      return {x:node.x+node.width/2-900,y:node.y+node.height/2-700,width:1800,height:1400};
    })})),sources:[]};
  for(const [i,provider] of ['elk-layered','native-layered'].entries()){
    const bytes=await readFile(join(input,`${id}.${provider}.svg`));
    const name=`${id}.${provider}.svg.gz`;
    await writeFile(join(output,name),gzipSync(bytes));
    row.sources.push({provider,name,sha256:sha256(bytes),bytes:bytes.length,nodes:graphs[i].nodes.length,edges:graphs[i].edges.length});
  }
  index.push(row);
}
await writeFile(join(output,'review_source.json'),JSON.stringify({sourceDirectory:input,geometryUnchanged:true,independentFit:false,
  policy:'whole: shared max bounds; detail: canonical same node, same 1800x1400 viewport; full SVG retained',cases:index},null,2));
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>H08 mapped 产品视觉验收</title>
<style>body{font:15px system-ui;margin:24px;background:#edf2f6;color:#172238}section{background:white;padding:16px;margin:24px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;min-width:0}img{width:100%;height:650px;background:#f4f6f8;border:1px solid #ccd7df}button{margin:8px;padding:8px}pre{white-space:pre-wrap}h2{font-size:18px}</style>
<h1>H08：三个预先声明的 mapped 分层样本</h1><p>左 ELK 0.11.1，右 H08。整体共同原点/尺度；局部同一 canonical 对象、同一1800×1400窗口，不分别Fit。完整完成态 SVG（包括标签和命中区域）未删改，仅改变展示viewBox；大文件gzip存储，浏览器本地解压。</p>
<p>整体用于追溯所有分支，极大图不能只看缩略图签收，请逐个查看固定局部窗口。更少交叉不能替代可读性；本页不把未审查的全体47图宣称为ELK等价。</p><main></main>
<script type="module">
const data=await fetch('./review_source.json').then(r=>r.json());
for(const row of data.cases){
 const section=document.createElement('section'),title=document.createElement('h2');title.textContent=row.id;section.append(title);
 const info=document.createElement('p');info.textContent='原完整图：'+row.sources.map(s=>s.provider+' '+s.nodes+'节点/'+s.edges+'边').join('；');section.append(info);
 const controls=document.createElement('div'),pair=document.createElement('div');pair.className='pair';section.append(controls,pair);document.querySelector('main').append(section);
 const images=[],texts=[],urls=[];
 for(const source of row.sources){const figure=document.createElement('figure'),caption=document.createElement('figcaption'),img=document.createElement('img');caption.textContent=source.provider;img.alt=source.provider+' '+row.id;figure.append(caption,img);pair.append(figure);images.push(img);
 const response=await fetch(source.name),stream=response.body.pipeThrough(new DecompressionStream('gzip'));texts.push(await new Response(stream).text());}
 const show=frames=>{for(let i=0;i<2;i++){if(urls[i])URL.revokeObjectURL(urls[i]);const f=frames[i];const text=texts[i].replace(/viewBox="[^"]*"/,'viewBox="'+[f.x,f.y,f.width,f.height].join(' ')+'"');urls[i]=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}));images[i].src=urls[i];}};
 const buttons=[{name:'整体（共同尺度）',frames:[0,1].map(()=>({x:0,y:0,...row.common}))},...row.anchors.map(a=>({name:'局部 '+a.nodeId,frames:a.frames}))];
 for(const item of buttons){const button=document.createElement('button');button.textContent=item.name;button.addEventListener('click',()=>show(item.frames));controls.append(button);}show(buttons[0].frames);
}
</script></html>`;
await writeFile(join(output,'index.html'),html);
console.log(JSON.stringify(index.map(({id,sources,anchors})=>({id,sources,anchors})),null,2));
