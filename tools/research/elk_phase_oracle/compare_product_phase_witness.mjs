import {readFile,writeFile} from 'node:fs/promises';
import {validateCapturedOracle} from './validate_captured_oracle.mjs';
const [inputFile,oracleFile,witnessFile,outputFile]=process.argv.slice(2);
if(!outputFile)throw new Error('usage: compare_product_phase_witness.mjs <input.json> <oracle.json> <candidate-witness.json> <output.json>');
const read=(file)=>readFile(file,'utf8').then(JSON.parse);
const [input,oracle,witness]=await Promise.all([read(inputFile),read(oracleFile),read(witnessFile)]);
validateCapturedOracle(oracle,input);
if(input.providerInputDigest!==witness.providerInputDigest)throw new Error('Product display input hashes differ');
const tracked=input.graph.edges.find((edge)=>edge.id===witness.edgeId);
if(!tracked)throw new Error('Tracked edge not in captured input');
const upstream=(boundary)=>oracle.snapshots.find((snapshot)=>snapshot.boundary===boundary);
const candidate=(phase)=>witness.phases.find((snapshot)=>snapshot.phase===phase);
const allNodes=(snapshot)=>snapshot.components.flatMap((component)=>component.nodes);
const allEdges=(snapshot)=>snapshot.components.flatMap((component)=>component.edges);
const owners=(snapshot)=>new Map(allNodes(snapshot).flatMap((node)=>node.ports.map((port)=>[port.id,node.id])));
const orientationOwners=owners(upstream('p1'));
const expectedOrientation=new Map(allEdges(upstream('p1')).map((edge)=>[edge.logicalEdgeId,{id:edge.logicalEdgeId,
  sourceNodeId:orientationOwners.get(edge.sourcePortId),targetNodeId:orientationOwners.get(edge.targetPortId),reversed:edge.reversed}]));
const orientationDiffs=candidate('p1').orientedEdges.filter((edge)=>JSON.stringify(edge)!==JSON.stringify(expectedOrientation.get(edge.id)));
const ranks=new Map(allNodes(upstream('p2')).map((node)=>[node.id,node.layer]));
const rankDiffs=candidate('p2').normalNodes.filter((node)=>node.layer!==ranks.get(node.id))
  .map((node)=>({id:node.id,upstream:ranks.get(node.id),candidate:node.layer}));
const p0Nodes=new Map(candidate('p0').normalNodes.map((node)=>[node.id,node]));
const portModelDiffs=allNodes(upstream('imported')).flatMap((node)=>{
  const actual=p0Nodes.get(node.id);
  const shape=(port,raw)=>[port.side,raw?port.box.x:port.x,raw?port.box.y:port.y,raw?port.box.width:port.width,raw?port.box.height:port.height];
  const expected=node.ports.map((port)=>shape(port,true)).sort();
  const observed=actual.ports.map((port)=>shape(port,false)).sort();
  return JSON.stringify(expected)===JSON.stringify(observed)?[]:[{nodeId:node.id,upstream:expected,candidate:observed}];
});
function pathWitness(snapshot){
  const nodes=new Map(allNodes(snapshot).map((node)=>[node.id,node])),portOwners=owners(snapshot),adjacency=new Map();
  for(const edge of allEdges(snapshot).filter((edge)=>edge.physicalNetId===tracked.physicalNet)){
    const source=portOwners.get(edge.sourcePortId),target=portOwners.get(edge.targetPortId);
    if(!adjacency.has(source))adjacency.set(source,[]);adjacency.get(source).push(target);
  }
  const queue=[tracked.source],previous=new Map([[tracked.source,null]]);
  for(let index=0;index<queue.length&&!previous.has(tracked.target);index++)for(const target of adjacency.get(queue[index])??[])
    if(!previous.has(target)){previous.set(target,queue[index]);queue.push(target);}
  const ids=[];
  if(previous.has(tracked.target))for(let id=tracked.target;id!==null;id=previous.get(id))ids.push(id);
  ids.reverse();
  const chain=ids.map((id)=>nodes.get(id)),dummies=chain.filter((node)=>node.kind==='long_edge');
  return {boundary:snapshot.boundary,pathFound:ids.length>0,dummyCount:dummies.length,
    distinctDummyY:new Set(dummies.map((node)=>node.box.y)).size,
    roundedDistinctDummyY:new Set(dummies.map((node)=>node.box.y.toFixed(6))).size,
    nodes:chain.map(({id,kind,layer,order,box})=>({id,kind,layer,order,y:box.y}))};
}
const bk=upstream('p4').phaseData.events.find((event)=>event.event==='bk-candidates');
const objective=oracle.snapshots.flatMap((snapshot)=>snapshot.phaseData.events)
  .filter((event)=>event.event==='network-simplex-result').reduce((sum,event)=>sum+event.objectiveWeightedSpan,0);
const result={caseId:input.caseId,providerInputDigest:input.providerInputDigest,edgeId:witness.edgeId,
  referenceDistinction:'Java upstream phase oracle is not the vendored elkjs product metric run.',
  firstInputDifference:portModelDiffs.length?'p0-port-model':null,portModelDiffs,
  orientationDiffs,rankDiffs,
  ranking:{upstreamObjective:objective,candidate:candidate('p2').ranking,
    upstreamLayers:upstream('p2').metrics.layerCount,candidateLayers:Math.max(...candidate('p2').normalNodes.map((node)=>node.layer))+1},
  upstreamPath:['p2','long_edge_split','p3','hyperedge_dummy_merge','p4','p5','restored','final']
    .map(upstream).filter(Boolean).map(pathWitness),
  upstreamBk:{selected:bk.selected.direction,candidates:bk.candidates.map(({direction,size,feasible})=>({direction,size,feasible}))},
  candidatePath:witness.phases.map(({phase,dummyCount,nodes,selected})=>({phase,dummyCount,selected,
    distinctDummyY:new Set(nodes.filter((node)=>node.kind==='long_edge').map((node)=>node.y)).size}))};
await writeFile(outputFile,`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify({caseId:result.caseId,firstInputDifference:result.firstInputDifference,
  portModelDiffs:portModelDiffs.length,orientationDiffs:orientationDiffs.length,rankDiffs:rankDiffs.length,
  ranking:result.ranking,upstreamBk:result.upstreamBk,upstreamPath:result.upstreamPath.map(({nodes,...summary})=>summary)}));
