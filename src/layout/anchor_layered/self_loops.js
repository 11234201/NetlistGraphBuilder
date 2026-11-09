import { compareIds,freezeRecord,checkCancelled } from './protocol.js';
import { createIntervalQuery } from './routing_dependencies.js';
import { removeRegularCycles } from './routing_cycles.js';
import { assignRoutingSlots } from './routing_slots.js';

// Scoped fixed W/E self-hyperloops: route choice, crossing dependencies and
// independent side compaction follow ELK's RoutingDirector/SlotAssigner semantics.
// Point/interval queries replace its unconditional loop-pair enumeration.
export function prepareSelfLoops(input,{signal}={}){
  const loopsByNode=new Map();
  for(const edge of input.selfLoops){
    if(!loopsByNode.has(edge.sourceNodeId))loopsByNode.set(edge.sourceNodeId,[]);
    loopsByNode.get(edge.sourceNodeId).push(edge);
  }
  const connected=new Set(input.edges.flatMap((edge)=>[edge.sourcePortId,edge.targetPortId]));
  const selfLoopRoutes=[];
  const nodes=input.nodes.map((node)=>{
    const edges=loopsByNode.get(node.id);if(!edges)return node;
    checkCancelled(signal);
    const portById=new Map(node.ports.map((port,index)=>[port.id,{...port,index}]));
    const parent=new Map();
    const find=(id)=>{if(!parent.has(id))parent.set(id,id);let root=id;while(parent.get(root)!==root)root=parent.get(root);
      while(parent.get(id)!==root){const next=parent.get(id);parent.set(id,root);id=next;}return root;};
    for(const edge of edges){const a=find(edge.sourcePortId),b=find(edge.targetPortId);if(a!==b)parent.set(b,a);}
    const groups=new Map();
    for(const edge of edges){const root=find(edge.sourcePortId);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(edge);}
    const portCount=node.ports.length,prefix=[0];
    for(const port of node.ports)prefix.push(prefix.at(-1)+(connected.has(port.id)?3:1));
    const penalty=(start,end)=>start<end?prefix[end]-prefix[start+1]:
      prefix[portCount]-prefix[start+1]+prefix[end];
    const loops=[...groups.values()].map((members)=>{
      const ports=[...new Set(members.flatMap((edge)=>[edge.sourcePortId,edge.targetPortId]))]
        .map((id)=>portById.get(id)).sort((a,b)=>a.index-b.index);
      const east=ports.filter((port)=>port.side==='EAST'),west=ports.filter((port)=>port.side==='WEST');
      let start=ports[0].index,end=ports.at(-1).index,sides=[ports[0].side];
      if(east.length&&west.length){
        const southPenalty=penalty(east[0].index,west.at(-1).index),northPenalty=penalty(west[0].index,east.at(-1).index);
        if(southPenalty<=northPenalty){start=east[0].index;end=west.at(-1).index;sides=['EAST','SOUTH','WEST'];}
        else{start=west[0].index;end=east.at(-1).index;sides=['WEST','NORTH','EAST'];}
      }
      return {id:`self-loop:${JSON.stringify(members.map((edge)=>edge.id).sort(compareIds))}`,members,ports,start,end,sides,slots:{}};
    }).sort((a,b)=>compareIds(a.id,b.id));
    const active=(loop,index)=>loop.start<=loop.end?index>=loop.start&&index<=loop.end:index>=loop.start||index<=loop.end;
    const intervals=loops.flatMap((loop)=>loop.start<=loop.end?[{id:loop.id,start:loop.start,end:loop.end,loop}]:
      [{id:`${loop.id}:0`,start:0,end:loop.end,loop},{id:`${loop.id}:1`,start:loop.start,end:portCount-1,loop}]);
    const query=createIntervalQuery(intervals),pairs=new Map();
    for(const loop of loops)for(const port of loop.ports)query(port.index,port.index,(interval)=>{
      const other=interval.loop;if(other===loop)return;
      const [a,b]=compareIds(loop.id,other.id)<0?[loop,other]:[other,loop];pairs.set(JSON.stringify([a.id,b.id]),[a,b]);
    });
    const dependencies=[];
    for(const [a,b] of pairs.values()){
      const first=a.ports.filter((port)=>active(b,port.index)).length,second=b.ports.filter((port)=>active(a,port.index)).length;
      const add=(source,target,weight)=>dependencies.push({source:source.id,target:target.id,type:'REGULAR',weight});
      if(first<second)add(a,b,second-first);else if(second<first)add(b,a,first-second);
      else if(first){add(a,b,0);add(b,a,0);}
    }
    const segments=loops.map((loop)=>({id:loop.id,start:0,end:1,incoming:[0],outgoing:[1]}));
    const acyclic=removeRegularCycles(segments,dependencies,{signal});
    const reversed=acyclic.dependencies.map((edge)=>({...edge,source:edge.target,target:edge.source}));
    const raw=assignRoutingSlots(segments,reversed,{signal}).slots,nextFree=new Array(portCount).fill(0);
    for(const side of ['NORTH','EAST','SOUTH','WEST']){
      const sidePorts=node.ports.map((port,index)=>({port,index})).filter(({port})=>port.side===side);
      const ordered=loops.filter((loop)=>loop.sides.includes(side)).sort((a,b)=>raw.get(a.id)-raw.get(b.id)||compareIds(a.id,b.id));
      for(let index=0;index<ordered.length;index++){
        const loop=ordered[index];let slot=sidePorts.length?0:index;
        for(const {index:portIndex} of sidePorts)if(active(loop,portIndex))slot=Math.max(slot,nextFree[portIndex]);
        loop.slots[side]=slot;
        for(const {index:portIndex} of sidePorts)if(active(loop,portIndex))nextFree[portIndex]=slot+1;
      }
    }
    const margins={...node.margins},base=node.margins;
    for(const loop of loops){
      const coordinate=(side)=>{
        const distance=input.options.nodeSelfLoopSpacing+loop.slots[side]*input.options.edgeEdgeSpacing;
        return side==='EAST'?node.width+base.right+distance:side==='WEST'?-base.left-distance:
          side==='SOUTH'?node.height+base.bottom+distance:-base.top-distance;
      };
      for(const edge of loop.members){
        const source=portById.get(edge.sourcePortId),target=portById.get(edge.targetPortId);
        const sourceX=coordinate(source.side),targetX=coordinate(target.side);
        const bendPoints=[{x:sourceX,y:source.y+source.anchor.y}];
        if(source.side!==target.side){const y=coordinate(loop.sides.includes('SOUTH')?'SOUTH':'NORTH');
          bendPoints.push({x:sourceX,y},{x:targetX,y});}
        bendPoints.push({x:targetX,y:target.y+target.anchor.y});
        for(const point of bendPoints){margins.left=Math.max(margins.left,-point.x);margins.right=Math.max(margins.right,point.x-node.width);
          margins.top=Math.max(margins.top,-point.y);margins.bottom=Math.max(margins.bottom,point.y-node.height);}
        selfLoopRoutes.push({edgeId:edge.id,nodeId:node.id,bendPoints});
      }
    }
    return {...node,margins};
  });
  selfLoopRoutes.sort((a,b)=>compareIds(a.edgeId,b.edgeId));
  return freezeRecord({...input,nodes,selfLoopRoutes});
}
