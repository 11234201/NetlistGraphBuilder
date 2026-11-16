import { PhaseError } from './anchor_layered/index.js';
import { executeNativeLayout } from './native_layout_execution.js';
import { getPort,getConnectionPoint,computeBoundsWithRoutes,computeSafeLayoutExtent } from './nodeGeometry.js';
import { materializeMeasuredGraph } from './measured_geometry.js';
import { createNativePortIdEncoder } from './native_port_ids.js';
import { MEASURED_GRAPH_CONTRACT } from '../contracts/measured_graph.js';
import { getNetGroupKey } from './layoutTopology.js';
import { buildWireRoutes } from './wireRoutes.js';
import { placeWireLabels } from './wireLabelPlacement.js';
import { finalizeLayoutGraph } from './layoutValidator.js';

export const ANCHOR_LAYERED_LAYOUT_PROVIDER_ID='native-layered';
export const NATIVE_LAYERED_LAYOUT_PROVIDER_ID=ANCHOR_LAYERED_LAYOUT_PROVIDER_ID;

const isAnchorProfile = (profile) => profile === 'anchor' || profile === 'anchor-layered' || profile === 'h08';

// Shared product adapter; the registry explicitly selects the accepted AnchorLayered (H08) profile.
// Measurement and public DTO conversion only; no coordinate or route repair pass.
export class MeasuredAnchorLayoutProvider{
  constructor({profile='anchor'}={}){
    const isAnchor = isAnchorProfile(profile);
    this.id=NATIVE_LAYERED_LAYOUT_PROVIDER_ID;
    this.label=isAnchor?'AnchorLayered':'AnchorLayered Baseline (Experimental)';
    this.experimental=!isAnchor;
    this.executionMode='async';
    this.profile=profile;
    this.measurementContract=MEASURED_GRAPH_CONTRACT;
  }
  async layoutMeasured(measuredGraph,options={}){
    const graph=materializeMeasuredGraph(measuredGraph);
    const spacing=options.layoutPolicy?.spacing??{},cellSpacing=spacing.cellSpacing??8;
    const measured=graph.nodes;
    const nodeById=new Map(measured.map((node)=>[node.id,node]));
    // A concat's A{ordinal} terminals share rawPin A but are distinct endpoints.
    const portId=createNativePortIdEncoder(measured);
    const endpoint=(node,port,role)=>{
      // Local coordinates use the same addition order as getConnectionPoint,
      // without copying a full node just to replace its frame with (0, 0).
      const offset=node.connectionOffsets[role];
      const point={x:(0+(port?.x??(role==='source'?node.width:0)))+offset.x,
        y:(0+(port?.y??node.height/2))+offset.y};
      return {id:portId(node.id,port,role),side:port?
        {left:'WEST',right:'EAST',top:'NORTH',bottom:'SOUTH'}[port.side]:role==='source'?'EAST':'WEST',
        x:point.x,y:point.y,width:0,height:0,borderOffset:port?.side==='left'?-point.x:
          port?.side==='right'?point.x-node.width:0};
    };
    const input={nodes:measured.map((node)=>({id:node.id,displayName:node.label??node.id,width:node.width,height:node.height,
      ports:node.ports.length?node.ports.map((port)=>endpoint(node,port,port.direction==='output'?'source':'target')):
        [endpoint(node,null,'source'),endpoint(node,null,'target')]})),edges:graph.edges.map((edge)=>{
      const sourceNode=nodeById.get(edge.source),targetNode=nodeById.get(edge.target);
      if(!sourceNode||!targetNode)throw new PhaseError('adapter','missing-endpoint-node',[edge.id]);
      const source=endpoint(sourceNode,getPort(sourceNode,edge.sourcePin,'source'),'source'),
        target=endpoint(targetNode,getPort(targetNode,edge.targetPin,'target'),'target');
      return {id:edge.id,physicalNetId:getNetGroupKey(edge),sourcePortId:source.id,targetPortId:target.id,
        minimumLength:edge.minimumLength??1};
    })};
    const result=await executeNativeLayout(input,{profile:this.profile,
      orderGroups:isAnchorProfile(this.profile)?measuredGraph.measurements.orderGroups:[],
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
      return {...edge,points,routeKind:'anchor-layered-orthogonal',routeStatus:'routed'};
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
