import {readFile} from 'node:fs/promises';
export function summarizeV8Profile(value){
  const cleaned=value.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[research module]');
  const lines=cleaned.split(/\r?\n/),javascript=[];let inJavascript=false;
  for(const line of lines){
    if(line.includes('[JavaScript]:')){inJavascript=true;continue;}
    if(inJavascript&&/^\s*\[/.test(line)){inJavascript=false;}
    if(inJavascript&&/^\s*\d+\s+\d/.test(line))javascript.push(line.trim().slice(0,600));
  }
  const start=cleaned.indexOf('[Summary]:');
  const end=cleaned.indexOf('[C++ entry points]:',start);
  return {javascript:javascript.slice(0,20),summary:start<0?'missing summary':cleaned.slice(start,end<0?start+1800:end).trim()};
}
if(process.argv[2])for(const file of process.argv.slice(2)){
  console.log(JSON.stringify({file,...summarizeV8Profile(await readFile(file,'utf8'))}));
}
