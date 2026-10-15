const phases=new Set(['orientGraph','assignLayers','buildProperGraph','orderLayers','placeNodes',
  'routeEdges','validateRoutes','validateLayoutGraph','finalizeLayoutGraph',
  'placeWireLabels','buildWireRoutes','computeBoundsWithRoutes']);

// Research-only loader transform. No onPhase callback or observe-event switch.
export function instrumentSyncPhases(source,moduleTag,{captureDirectory=null,captureBoundary='validateLayoutGraph'}={}){
  const names=[];
  const transformed=source.replace(/^export function ([A-Za-z]+)\(/gm,(declaration,name)=>{
    if(!phases.has(name))return declaration;
    names.push(name);
    return `function __phaseTimingImpl_${name}(`;
  });
  if(!names.length)return source;
  const captures=captureDirectory&&names.includes(captureBoundary);
  const captureImports=captures?`import {writeFileSync as __captureWrite,mkdirSync as __captureMkdir} from 'node:fs';
import {serialize as __captureSerialize} from 'node:v8';
import {resolve as __captureResolve} from 'node:path';`:'';
  const wrappers=names.map((name)=>{
    const header=JSON.stringify({phase:name,module:moduleTag});
    return `let __phaseTimingCall_${name}=0;
export function ${name}(...args){
 const call=++__phaseTimingCall_${name},started=performance.now(),cpu=process.cpuUsage();
 console.error('phase_timing_begin='+JSON.stringify({...${header},call}));
 ${captures&&name===captureBoundary?`if(call===1){
 __captureMkdir(${JSON.stringify(captureDirectory)},{recursive:true});
 const destination=__captureResolve(${JSON.stringify(captureDirectory)},${JSON.stringify(`${moduleTag}.${captureBoundary==='buildWireRoutes'?'wire_routes':captureBoundary==='orderLayers'?'ordering':'validation'}.bin`)});
 __captureWrite(destination,__captureSerialize(${captureBoundary==='buildWireRoutes'?
  "{phase:'buildWireRoutes',edges:args[0]}":`{phase:${JSON.stringify(captureBoundary)},graph:args[0],options:args[1]}`}));
 console.error('phase_input_captured='+JSON.stringify({phase:${JSON.stringify(captureBoundary)},destination}));
 }`:''}
 try{return __phaseTimingImpl_${name}(...args);}
 finally{const used=process.cpuUsage(cpu);console.error('phase_timing_end='+JSON.stringify({...${header},call,
 elapsedMs:performance.now()-started,cpuMs:(used.user+used.system)/1000}));}
}`;
  }).join('\n');
  return `${captureImports}\n${transformed}\n${wrappers}\n`;
}
