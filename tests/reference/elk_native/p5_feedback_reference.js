// Deliberately quadratic, test-only weighted Eades reference. Recompute every
// remaining-node degree at each decision; do not import production heaps/state.
export function referenceFeedback(segments,dependencies,criticalOnly=false){
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  const ids=segments.map(({id})=>id).sort(),active=new Set(ids),first=[],last=[];
  const arcs=dependencies.filter((edge)=>!criticalOnly||edge.type==='CRITICAL');
  const degree=(id)=>{
    let incoming=0,outgoing=0,criticalIncoming=0,criticalOutgoing=0;
    for(const edge of arcs){
      if(!active.has(edge.source)||!active.has(edge.target))continue;
      if(edge.source===id){outgoing+=edge.weight;if(edge.type==='CRITICAL')criticalOutgoing+=edge.weight;}
      if(edge.target===id){incoming+=edge.weight;if(edge.type==='CRITICAL')criticalIncoming+=edge.weight;}
    }
    return {id,incoming,outgoing,criticalIncoming,criticalOutgoing};
  };
  const take=(predicate,right)=>{
    const node=ids.filter((id)=>active.has(id)).map(degree).find(predicate);
    if(!node)return false;
    active.delete(node.id);(right?last:first).push(node.id);return true;
  };
  while(active.size){
    while(take((node)=>node.outgoing<=0,true)){}
    while(take((node)=>node.incoming<=0&&node.outgoing>0,false)){}
    if(!active.size)break;
    if(!criticalOnly&&take((node)=>node.criticalOutgoing>0&&node.criticalIncoming<=0,false))continue;
    const candidates=ids.filter((id)=>active.has(id)).map(degree);
    candidates.sort((a,b)=>(b.outgoing-b.incoming)-(a.outgoing-a.incoming)||compare(a.id,b.id));
    active.delete(candidates[0].id);first.push(candidates[0].id);
  }
  const order=[...first,...last.reverse()],positions=new Map(order.map((id,index)=>[id,index]));
  const feedback=arcs.filter((edge)=>positions.get(edge.source)>positions.get(edge.target))
    .sort((a,b)=>compare(a.source,b.source)||compare(a.target,b.target)||compare(a.type,b.type)||a.weight-b.weight);
  return {order,feedback};
}
