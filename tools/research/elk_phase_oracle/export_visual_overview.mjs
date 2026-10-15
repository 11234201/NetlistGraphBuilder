// Presentation-only: retain the complete saved SVG, including geometry/labels.
// Both sides use one common origin/viewBox/output size; never separately Fit.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const [runDirectory,outputDirectory,...caseIds]=process.argv.slice(2);
if(!caseIds.length)throw new Error('usage: export_visual_overview.mjs <run-dir> <output-dir> <case-id>...');
await mkdir(outputDirectory,{recursive:true});
for(const caseId of caseIds){
  if(!/^[a-z0-9_]+$/.test(caseId))throw new Error('Unsafe case identifier');
  const report=JSON.parse(await readFile(path.join(runDirectory,`${caseId}.report.json`),'utf8'));
  const width=Math.max(...report.reports.map((entry)=>entry.width));
  const height=Math.max(...report.reports.map((entry)=>entry.height));
  for(const {provider} of report.reports){
    const saved=await readFile(path.join(runDirectory,`${caseId}.${provider}.svg`),'utf8');
    // CairoSVG does not resolve CSS custom properties. Resolve only the saved
    // export stylesheet's own definitions, never netlist-controlled SVG text.
    const rasterCompatible=saved.replace(/<style>([\s\S]*?)<\/style>/g,(_match,css)=>{
      const values=new Map([...css.matchAll(/--([\w-]+)\s*:\s*([^;}]+)[;}]/g)].map((match)=>[match[1],match[2].trim()]));
      const resolved=css.replace(/var\(--([\w-]+)\)/g,(_value,name)=>{
        if(!values.has(name))throw new Error(`Unresolved exported CSS variable ${name}`);
        return values.get(name);
      });
      return `<style>${resolved}</style>`;
    });
    const projected=rasterCompatible.replace(/<svg\b[^>]*>/,(root)=>root.replace(/\s(?:width|height|viewBox|preserveAspectRatio)="[^"]*"/g,'')
      .replace(/>$/,` width="800" height="700" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">`));
    if(projected===saved)throw new Error('No root SVG viewport to project');
    await writeFile(path.join(outputDirectory,`${caseId}.${provider}.overview.svg`),projected);
  }
  console.log(JSON.stringify({caseId,viewport:{x:0,y:0,width,height},output:{width:800,height:700},
    geometryScale:Math.min(800/width,700/height),detail:'overview only; full geometry/labels retained, local details reviewed separately'}));
}
