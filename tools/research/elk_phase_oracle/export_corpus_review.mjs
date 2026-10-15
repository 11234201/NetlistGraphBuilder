import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {escapeHtml} from '../../../src/ui/html.js';
import {sha256} from './quality_baseline.mjs';

export function projectComparisonSvg(source,{width,height}){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('invalid common bounds');
  const root=source.match(/<svg\b[^>]*>/)?.[0];if(!root)throw Error('missing SVG root');
  const projected=root.replace(/\s(?:width|height|viewBox|preserveAspectRatio)="[^"]*"/g,'')
    .replace(/>$/,` width="720" height="360" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">`);
  return source.replace(root,projected);
}

export async function exportCorpusReview(inputDirectory,outputDirectory){
  const bytes=await readFile(join(inputDirectory,'summary.json')),summary=JSON.parse(bytes);
  const sections=[],viewports=[],probes=[];
  await mkdir(outputDirectory,{recursive:true});
  for(const report of summary.reports.toSorted((a,b)=>a.caseId<b.caseId?-1:a.caseId>b.caseId?1:0)){
    const id=report.caseId;if(!/^[a-z0-9_]+$/.test(id))throw Error('unsafe case ID');
    if(report.status==='mechanism-probe-not-a-visual-graph'){probes.push(id);continue;}
    const metrics=['elk-layered','native-layered'].map(provider=>report.metrics?.find(row=>row.provider===provider));
    if(metrics.some(row=>!row))throw Error(`missing complete comparison: ${id}`);
    const bounds={width:Math.max(...metrics.map(row=>row.width)),height:Math.max(...metrics.map(row=>row.height))};
    for(const metric of metrics){
      const source=await readFile(join(inputDirectory,`${id}.${metric.provider}.svg`),'utf8');
      await writeFile(join(outputDirectory,`${id}.${metric.provider}.review.svg`),projectComparisonSvg(source,bounds));
    }
    viewports.push({caseId:id,...bounds});
    sections.push(`<section><h2>${escapeHtml(id)}</h2><p>${escapeHtml(report.status)}</p><div class="pair">`+
      metrics.map((metric,index)=>`<figure><figcaption>${index?'H08 static':'ELK 0.11.1'}</figcaption><img src="${id}.${metric.provider}.review.svg" alt="${escapeHtml(id)}"></figure>`).join('')+'</div></section>');
  }
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>H08 静态机制场景视觉评审</title>
<style>body{font:15px system-ui;margin:24px;background:#edf2f6;color:#172238}section{background:white;padding:18px;margin:24px 0;border-radius:10px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;min-width:0}figcaption{font-weight:600;margin-bottom:8px}img{width:100%;height:360px;object-fit:contain;background:#f4f6f8;border:1px solid #dde3ec}h2{font-size:17px}</style>
<h1>H08 静态入口：${viewports.length} 组机制场景</h1><p>左 ELK，右 H08 static。每组共同原点、共同实际 bounds/viewBox 和输出尺寸，未分别 Fit；完整几何和标签保留，仅去掉渲染器默认最小画布的额外空白。</p>
<p>另有 ${probes.length} 条专用探针报告，不算完整视觉图。请评审结构、分支、路线和留白；数值通过不等于视觉通过。</p><p>本页仅作视觉评审，是否部署仍以正式全图、产品与离线门禁为准。</p>${sections.join('\n')}</html>`;
  await writeFile(join(outputDirectory,'index.html'),html);
  const provenance={runId:summary.runId,runtimeDigest:summary.runtimeDigest,sourceSummaryDigest:sha256(bytes),
    graphCount:viewports.length,probeReports:probes,viewports,fullGeometryRetained:true,independentFit:false};
  await writeFile(join(outputDirectory,'review_source.json'),JSON.stringify(provenance,null,2));
  return provenance;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2]||!process.argv[3])throw Error('usage: export_corpus_review.mjs <complete-run-directory> <output-directory>');
  console.log(JSON.stringify(await exportCorpusReview(resolve(process.argv[2]),resolve(process.argv[3]))));
}
