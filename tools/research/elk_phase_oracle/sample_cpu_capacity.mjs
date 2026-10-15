import {readFile} from 'node:fs/promises';

// Read-only two-sample execution-environment diagnostic; never changes other jobs.
const status=await readFile('/proc/self/status','utf8');
const allowedText=status.match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1];
if(!allowedText)throw Error('missing CPU affinity information');
const allowed=new Set(allowedText.split(',').flatMap(range=>{
  const [start,end=start]=range.split('-').map(Number);
  return Array.from({length:end-start+1},(_,index)=>start+index);
}));
const read=async()=>new Map((await readFile('/proc/stat','utf8')).split('\n').filter(line=>/^cpu\d+\s/.test(line)).map(line=>{
  const [label,...fields]=line.trim().split(/\s+/),values=fields.slice(0,8).map(Number);
  return [Number(label.slice(3)),{total:values.reduce((a,b)=>a+b,0),idle:values[3]+values[4]}];
}));
const before=await read();await new Promise(resolve=>setTimeout(resolve,1000));const after=await read();
const samples=[...after].filter(([cpu])=>allowed.has(cpu)).map(([cpu,value])=>{
  const previous=before.get(cpu),total=value.total-previous.total;
  return {cpu,busy:total?1-(value.idle-previous.idle)/total:1};
}).sort((a,b)=>a.busy-b.busy||a.cpu-b.cpu);
const cores=new Map();
for(const row of samples){
  const siblings=(await readFile(`/sys/devices/system/cpu/cpu${row.cpu}/topology/thread_siblings_list`,'utf8')).trim();
  if(!cores.has(siblings))cores.set(siblings,{siblings,busy:0,threads:[]});
  const core=cores.get(siblings);core.busy+=row.busy;core.threads.push(row);
}
const ordered=[...cores.values()].sort((a,b)=>a.busy-b.busy||a.threads[0].cpu-b.threads[0].cpu);
console.log(JSON.stringify({allowed:allowedText,sampleMs:1000,samples,cores:ordered,
  selection:'four distinct physical cores by summed sibling busy; least-busy allowed thread per core',
  suggestedCpuSet:ordered.slice(0,4).map(core=>core.threads[0].cpu).sort((a,b)=>a-b).join(',')}));
