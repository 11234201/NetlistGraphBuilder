import { compareIds, PhaseError, checkCancelled } from './protocol.js';
import { PriorityQueue } from './priority_queue.js';

const dependencyOrder=(a,b)=>compareIds(a.source,b.source)||compareIds(a.target,b.target)
  ||compareIds(a.type,b.type)||a.weight-b.weight;

// Weighted Eades feedback ordering with mandatory critical-edge precedence. Indexed
// lazy heaps replace the source's full remaining-set max-outflow scans, preserving stable ties.
export function feedbackDependencies(segments,dependencies,criticalOnly=false,{signal}={}) {
  const state=new Map(segments.map((segment)=>[segment.id,{id:segment.id,incoming:0,outgoing:0,
    criticalIncoming:0,criticalOutgoing:0,version:0,active:true}]));
  const incoming=new Map(segments.map((segment)=>[segment.id,[]])),outgoing=new Map(segments.map((segment)=>[segment.id,[]]));
  for(const edge of dependencies) {
    if(!state.has(edge.source)||!state.has(edge.target))throw new PhaseError('p5','missing-dependency-segment');
    incoming.get(edge.target).push(edge);outgoing.get(edge.source).push(edge);
    if(criticalOnly&&edge.type!=='CRITICAL')continue;
    state.get(edge.source).outgoing+=edge.weight;state.get(edge.target).incoming+=edge.weight;
    if(edge.type==='CRITICAL') {state.get(edge.source).criticalOutgoing+=edge.weight;state.get(edge.target).criticalIncoming+=edge.weight;}
  }
  const byId=(a,b)=>compareIds(a.id,b.id);
  const sources=new PriorityQueue(byId),sinks=new PriorityQueue(byId),critical=new PriorityQueue(byId);
  const maxFlow=new PriorityQueue((a,b)=>b.flow-a.flow||byId(a,b));
  const refresh=(node)=> {
    node.version++;
    const item={id:node.id,version:node.version,flow:node.outgoing-node.incoming};
    maxFlow.push(item);
    if(node.outgoing<=0)sinks.push(item);
    else if(node.incoming<=0)sources.push(item);
    if(node.criticalOutgoing>0&&node.criticalIncoming<=0)critical.push(item);
  };
  for(const node of state.values())refresh(node);
  const take=(queue,predicate)=> {
    while(queue.size) {const item=queue.pop(),node=state.get(item.id);
      if(node.active&&node.version===item.version&&predicate(node))return node;}
    return null;
  };
  const first=[],last=[];
  let remaining=segments.length;
  const remove=(node,right)=> {
    node.active=false;remaining--;(right?last:first).push(node.id);
    for(const edge of outgoing.get(node.id)) {
      if(criticalOnly&&edge.type!=='CRITICAL'||edge.weight<=0)continue;
      const target=state.get(edge.target);
      if(target.active) {target.incoming-=edge.weight;if(edge.type==='CRITICAL')target.criticalIncoming-=edge.weight;refresh(target);}
    }
    for(const edge of incoming.get(node.id)) {
      if(criticalOnly&&edge.type!=='CRITICAL'||edge.weight<=0)continue;
      const source=state.get(edge.source);
      if(source.active) {source.outgoing-=edge.weight;if(edge.type==='CRITICAL')source.criticalOutgoing-=edge.weight;refresh(source);}
    }
  };
  while(remaining) {
    checkCancelled(signal);
    let node;
    while((node=take(sinks,(entry)=>entry.outgoing<=0)))remove(node,true);
    while((node=take(sources,(entry)=>entry.incoming<=0&&entry.outgoing>0)))remove(node,false);
    if(remaining) {
      node=!criticalOnly?take(critical,(entry)=>entry.criticalOutgoing>0&&entry.criticalIncoming<=0):null;
      node??=take(maxFlow,()=>true);
      remove(node,false);
    }
  }
  const order=[...first,...last.reverse()],positions=new Map(order.map((id,index)=>[id,index]));
  const feedback=dependencies.filter((edge)=>(!criticalOnly||edge.type==='CRITICAL')&&positions.get(edge.source)>positions.get(edge.target))
    .sort(dependencyOrder);
  if(!criticalOnly&&feedback.some((edge)=>edge.type==='CRITICAL'))throw new PhaseError('p5','unresolved-critical-cycle');
  return {order,feedback};
}

export function removeRegularCycles(segments,dependencies,options) {
  const {order,feedback}=feedbackDependencies(segments,dependencies,false,options);
  const selected=new Set(feedback);
  const decisions=feedback.map((edge)=>({action:edge.weight===0?'remove':'reverse',dependency:{...edge}}));
  return {order,decisions,dependencies:dependencies.filter((edge)=>!selected.has(edge)||edge.weight>0)
    .map((edge)=>selected.has(edge)?{...edge,source:edge.target,target:edge.source}:{...edge}).sort(dependencyOrder)};
}
