import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const defaults=['README.md','CHANGELOG.md','native/README.md','tools/eda/README.md',
  'src/layout/anchor_layered/README.md', ...await markdownFiles('docs')];
async function markdownFiles(directory) {
  const result = [];
  for (const entry of await readdir(resolve(root,directory), {withFileTypes:true})) {
    const name = directory + '/' + entry.name;
    if (entry.isDirectory()) result.push(...await markdownFiles(name));
    else if (entry.isFile() && name.endsWith('.md')) result.push(name);
  }
  return result.sort();
}
let checked=0,artifacts=0,failed=0;
for(const name of process.argv.length>2?process.argv.slice(2):defaults){
  const file=resolve(root,name);
  const content=(await readFile(file,'utf8')).replace(/^\s*```[^\n]*\n[\s\S]*?^\s*```\s*$/gm,'');
  for(const match of content.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)){
    const target=match[1].replace(/^<|>$/g,'');
    if(target.startsWith('#')||/^[a-z][\w+.-]*:/i.test(target)&&! /^[a-z]:[\\/]/i.test(target))continue;
    if(isAbsolute(target)||/^[a-z]:[\\/]/i.test(target)){artifacts++;continue;}
    let path;
    try{path=decodeURIComponent(target.split('#')[0]);}catch{path=target;}
    if(!path)continue;
    checked++;
    try{await stat(resolve(dirname(file),path));}catch{
      failed++;
      console.error(`${name}: missing relative link ${target}`);
    }
  }
}
console.log(`docs links: checked=${checked}, missing=${failed}, skippedAbsoluteArtifacts=${artifacts}; external URLs and anchors not checked`);
if(failed)process.exitCode=1;
