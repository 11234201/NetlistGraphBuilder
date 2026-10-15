// Test/research inputs only. Production algorithms must not import this module.
import {inputFromSnapshot} from './elk_phase_inputs.js';
const compare=(a,b)=>a<b?-1:a>b?1:0;
const size=(id,width=40,height=30)=>({id,width,height});
const edge=(id,source,target,physicalNet=`n_${id}`,extra={})=>({id,source,target,physicalNet,...extra});

export function canonicalFromSpec(spec){
  const orderedEdges=[...spec.edges].sort((a,b)=>compare(a.id,b.id));
  const endpoint=new Map(),nodes=[...spec.nodes].sort((a,b)=>compare(a.id,b.id)).map((node)=>{
    const incoming=orderedEdges.filter((item)=>item.target===node.id).sort((a,b)=>
      (a.targetOrder??0)-(b.targetOrder??0)||compare(a.id,b.id));
    const outgoing=[...new Map(orderedEdges.filter((item)=>item.source===node.id).map((item)=>[item.physicalNet,item])).values()]
      .sort((a,b)=>(a.sourceOrder??0)-(b.sourceOrder??0)||compare(a.physicalNet,b.physicalNet));
    const ports=[];
    for(const [side,entries] of [['WEST',incoming],['EAST',outgoing]])entries.forEach((item,index)=>{
      const id=`${node.id}::${side}:${encodeURIComponent(side==='WEST'?item.id:item.physicalNet)}`;
      ports.push({id,side,x:side==='WEST'?0:node.width,y:node.height*(index+1)/(entries.length+1),width:0,height:0});
      if(side==='WEST')endpoint.set(`target:${item.id}`,id);
      else for(const branch of orderedEdges.filter((branch)=>branch.source===node.id&&branch.physicalNet===item.physicalNet))
        endpoint.set(`source:${branch.id}`,id);
    });
    return {id:node.id,width:node.width,height:node.height,ports};
  });
  return {nodes,edges:orderedEdges.map((item)=>({id:item.id,physicalNetId:item.physicalNet,
    sourcePortId:endpoint.get(`source:${item.id}`),targetPortId:endpoint.get(`target:${item.id}`)}))};
}
function generatedSpec(entry){
  const config=entry.generator,nodeSize=config.nodeSize??[40,30],node=(id)=>size(id,...nodeSize);
  switch(config.kind){
    case 'tree':{
      const nodes=[node('tree_0')],edges=[];let frontier=['tree_0'],next=1;
      for(let level=0;level<config.depth;level++){
        const children=[];
        for(const parent of frontier)for(let branch=0;branch<config.branching;branch++){
          const id=`tree_${next++}`;nodes.push(node(id));children.push(id);edges.push(edge(`${id}_to_${parent}`,id,parent));
        }
        frontier=children;
      }
      return {nodes,edges};
    }
    case 'unbalanced_tree_shared_leaf':return {nodes:['shared','left_leaf','left_mid','left','right','root'].map(node),edges:[
      edge('shared_left','shared','left_leaf','shared_net'),edge('shared_right','shared','right','shared_net'),
      edge('left_0','left_leaf','left_mid'),edge('left_1','left_mid','left'),edge('left_root','left','root'),edge('right_root','right','root')]};
    case 'cycle_with_self_loop':{
      const nodes=Array.from({length:config.cycleNodeCount},(_,index)=>node(`cycle_${index}`));
      return {nodes,edges:[...nodes.map((item,index)=>edge(`cycle_edge_${index}`,item.id,nodes[(index+1)%nodes.length].id)),
        edge('self_loop','cycle_1','cycle_1')]};
    }
    case 'external_ports':{
      const inputs=Array.from({length:config.inputCount},(_,index)=>size(`input_${index}`,46,28));
      const cells=Array.from({length:config.cellCount},(_,index)=>node(`cell_${index}`));
      const outputs=Array.from({length:config.outputCount},(_,index)=>size(`output_${index}`,46,36));
      return {nodes:[...inputs,...cells,...outputs],edges:[
        ...inputs.map((item,index)=>edge(`input_link_${index}`,item.id,cells[0].id)),
        ...cells.slice(1).map((item,index)=>edge(`cell_link_${index}`,cells[index].id,item.id)),
        ...outputs.map((item,index)=>edge(`output_link_${index}`,cells.at(-1).id,item.id,'output_fan'))]};
    }
    case 'disconnected':return {nodes:[...['chain_a','chain_b','chain_c','chain_d','diamond_a','diamond_b','diamond_c','diamond_d','isolated'].map(node)],
      edges:[edge('chain_ab','chain_a','chain_b'),edge('chain_bc','chain_b','chain_c'),edge('chain_cd','chain_c','chain_d'),
        edge('diamond_ab','diamond_a','diamond_b'),edge('diamond_ac','diamond_a','diamond_c'),
        edge('diamond_bd','diamond_b','diamond_d'),edge('diamond_cd','diamond_c','diamond_d')]};
    case 'unequal_heights_dense_ports':{
      const nodes=config.heights.map((height,index)=>size(`dense_${index}`,40,height)),edges=[];
      for(let layer=0;layer<nodes.length-1;layer++)for(let pin=0;pin<config.portsPerSide;pin++)
        edges.push(edge(`dense_${layer}_${pin}`,nodes[layer].id,nodes[layer+1].id,`dense_net_${layer}_${pin}`,
          {sourceOrder:pin,targetOrder:config.portsPerSide-pin-1}));
      return {nodes,edges};
    }
    default:throw new Error(`Unimplemented test-only generator: ${config.kind}`);
  }
}
export function materializeSyntheticCase(entry,oracle=null){
  if(entry.mechanismProbe)return null;
  if(entry.tier!=='synthetic')throw new Error(`Not a synthetic graph: ${entry.id}`);
  if(oracle)return {input:inputFromSnapshot(oracle.snapshots[0]),provenance:'pinned-imported-snapshot'};
  const spec=entry.graph??generatedSpec(entry);
  return {input:canonicalFromSpec(spec),provenance:entry.graph?'manifest-inline':'test-only-generator'};
}
