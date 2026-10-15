import {readFile} from 'node:fs/promises';
const data=JSON.parse(await readFile(process.argv[2],'utf8'));
const median=(values)=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
for(const result of data.results){
  const samples=Object.fromEntries(Object.entries(result.samples).map(([name,values])=>[name,
    {wallMs:median(values.map((value)=>value.wallMs)),cpuMs:median(values.map((value)=>value.cpuMs))}]));
  console.log(JSON.stringify({label:result.label,pivotCount:result.pivotCount,
    exactResultEqual:result.exactResultEqual,...samples}));
}
