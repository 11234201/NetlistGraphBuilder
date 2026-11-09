import { freezeRecord, PhaseError } from './protocol.js';

// Measured flat W/E port geometry, corresponding to the node-size/margin processors.
// Fixed y/anchors stay fixed; x is derived from side, width and explicit border offset.
export function preparePortGeometry(input) {
  const nodes=input.nodes.map((node)=> {
    const ports=node.ports.map((port)=> {
      if(!['WEST','EAST'].includes(port.side))throw new PhaseError('port_geometry','unsupported-flat-side',[port.id]);
      const offset=port.borderOffset??0;
      if(!Number.isFinite(offset))throw new PhaseError('port_geometry','invalid-border-offset',[port.id]);
      return {...port,x:port.side==='WEST'?-port.width-offset:node.width+offset};
    });
    const margins={...node.margins};
    for(const port of ports) {
      margins.left=Math.max(margins.left,-port.x);
      margins.right=Math.max(margins.right,port.x+port.width-node.width);
      margins.top=Math.max(margins.top,-port.y);
      margins.bottom=Math.max(margins.bottom,port.y+port.height-node.height);
    }
    return {...node,ports,margins};
  });
  return freezeRecord({...input,phase:'port_geometry',nodes});
}
