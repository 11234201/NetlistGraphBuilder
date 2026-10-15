import { layoutGraph,PhaseError } from './elk_native/index.js';
import { buildNodePorts,getPort,getConnectionPoint,measureNode,computeBoundsWithRoutes,computeSafeLayoutExtent } from './nodeGeometry.js';
import { getNetGroupKey } from './layoutTopology.js';
import { buildWireRoutes } from './wireRoutes.js';
import { placeWireLabels } from './wireLabelPlacement.js';
import { finalizeLayoutGraph } from './layoutValidator.js';
import {buildFocusedFaninTreeBlocks} from './layered/focusedTreeBlocks.js';

export const NATIVE_LAYERED_LAYOUT_PROVIDER_ID='native-layered';

// Shared product adapter; the registry explicitly selects the accepted H08 profile.
// Measurement and public DTO conversion only; no coordinate or route repair pass.
export class NativeLayeredLayoutProvider{
  constructor({profile='baseline'}={}){this.id=NATIVE_LAYERED_LAYOUT_PROVIDER_ID;this.label=profile==='h08'?'Native Layered H08':'Native Layered (Experimental)';this.experimental=profile!=='h08';this.executionMode='async';this.profile=profile;}
  async layout(graph,options={}){
    const spacing=options.layoutPolicy?.spacing??{},cellSpacing=spacing.cellSpacing??8;
    const measured=graph.nodes.map((node)=>{
      const size=Number.isFinite(node.width)&&Number.isFinite(node.height)?node:measureNode(node,spacing.cellPinPitch);
      const sized={...node,width:size.width,height:size.height};
      return {...sized,ports:buildNodePorts(sized,sized,spacing.cellPinPitch)};
    });
    const nodeById=new Map(measured.map((node)=>[node.id,node]));
    const portId=(nodeId,port)=>`${nodeId}::${port.direction}:${encodeURIComponent(port.rawPin||port.pin)}`;
    const endpoint=(node,pin,role)=>{
      const port=getPort(node,pin,role),point=getConnectionPoint({...node,x:0,y:0},pin,role);
      return {id:port?portId(node.id,port):`${node.id}::virtual:${role}`,side:port?
        {left:'WEST',right:'EAST',top:'NORTH',bottom:'SOUTH'}[port.side]:role==='source'?'EAST':'WEST',
        x:point.x,y:point.y,width:0,height:0,borderOffset:port?.side==='left'?-point.x:
          port?.side==='right'?point.x-node.width:0};
    };
    const input={nodes:measured.map((node)=>({id:node.id,displayName:node.label??node.id,width:node.width,height:node.height,
      ports:node.ports.length?node.ports.map((port)=>endpoint({...node,ports:[port]},port.rawPin??port.pin,port.direction==='output'?'source':'target')):
        [endpoint(node,null,'source'),endpoint(node,null,'target')]})),edges:graph.edges.map((edge)=>{
      const sourceNode=nodeById.get(edge.source),targetNode=nodeById.get(edge.target);
      if(!sourceNode||!targetNode)throw new PhaseError('adapter','missing-endpoint-node',[edge.id]);
      const source=endpoint(sourceNode,edge.sourcePin,'source'),target=endpoint(targetNode,edge.targetPin,'target');
      return {id:edge.id,physicalNetId:getNetGroupKey(edge),sourcePortId:source.id,targetPortId:target.id,
        minimumLength:edge.minimumLength??1};
    })};
    const result=await layoutGraph(input,{profile:this.profile,
      orderGroups:this.profile==='h08'?buildFocusedFaninTreeBlocks(graph.nodes,graph.edges).entries:[],
      policy:{nodeNodeSpacing:40+cellSpacing,nodeNodeBetweenLayers:72+cellSpacing,
      ...(options.nativeLayered?.policy??{})},signal:options.signal,onPhase:options.nativeLayered?.onPhase,
      yieldControl:options.nativeLayered?.yieldControl});
    const nodePositions=new Map(result.nodes.map((node)=>[node.id,node])),edgeRoutes=new Map(result.edges.map((edge)=>[edge.id,edge]));
    const margin=spacing.margin??32;
    const nodes=measured.map((node)=>({...node,x:nodePositions.get(node.id).x+margin,y:nodePositions.get(node.id).y+margin}));
    const positionedById=new Map(nodes.map((node)=>[node.id,node]));
    const routed=graph.edges.map((edge)=>{
      const points=edgeRoutes.get(edge.id).points.map((point)=>({x:point.x+margin,y:point.y+margin}));
      // Project port anchors from the emitted node frame, not (x + port) +
      // margin: floating addition is not associative. This is DTO/frame
      // conversion only; intermediate bends and layer/node positions stay fixed.
      points[0]=getConnectionPoint(positionedById.get(edge.source),edge.sourcePin,'source');
      points[points.length-1]=getConnectionPoint(positionedById.get(edge.target),edge.targetPin,'target');
      return {...edge,points,routeKind:'native-elk-orthogonal',routeStatus:'routed'};
    });
    const edges=placeWireLabels(routed,nodes),wireRoutes=buildWireRoutes(edges);
    const bounds=computeBoundsWithRoutes(nodes,edges,wireRoutes),extent=computeSafeLayoutExtent(bounds,margin);
    return finalizeLayoutGraph({...graph,nodes,edges,wireRoutes,width:extent.width,height:extent.height,layoutProvider:this.id,
      providerDiagnostics:result.phaseData.components.filter((component)=>!component.ranking.optimal).map((component)=>
        ({code:'ranking-iteration-limit',severity:'warning',phase:'p2',componentId:component.componentId,
          message:'Feasible ranks retained at the ELK iteration budget; optimum is not certified.',ranking:component.ranking})),
      layoutMetrics:{contractVersion:result.contractVersion,inputDigest:result.inputDigest,
        components:result.phaseData.components,placements:result.phaseData.placements,
        ...(result.phaseData.profile?{profile:result.phaseData.profile}:{})}});
  }
}
