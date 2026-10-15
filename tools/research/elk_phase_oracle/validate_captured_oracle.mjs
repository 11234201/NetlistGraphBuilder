import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from './quality_baseline.mjs';

// Run-local provider oracles are not manifest fixtures. Validate their captured
// identities and imported endpoint ownership without pretending implicit ELK
// ports are the candidate adapter's fixed virtual ports.
export function validateCapturedOracle(oracle,input){
  assert.equal(oracle.schemaVersion,'1.1.0');
  assert.equal(oracle.producer.sourceCommit,'28e5173243cab0cf4e2c9816c803bc0d5c47ab24');
  assert.equal(oracle.fixture.caseId,input.caseId);
  assert.equal(oracle.fixture.inputDigest,input.inputDigest);
  assert.deepEqual(oracle.run.options,input.options);
  assert.ok(Object.keys(oracle.run.resolvedOptions).length>=150);
  const inputNodes=new Map(input.graph.nodes.map((node)=>[node.id,node]));
  const inputEdges=new Map(input.graph.edges.map((edge)=>[edge.id,edge]));
  const imported=oracle.snapshots[0].components;
  assert.equal(oracle.snapshots[0].boundary,'imported');
  assert.deepEqual(imported.flatMap((component)=>component.nodes.map((node)=>node.id)).sort(),[...inputNodes.keys()].sort());
  assert.deepEqual(imported.flatMap((component)=>component.edges.map((edge)=>edge.logicalEdgeId)).sort(),[...inputEdges.keys()].sort());
  const importedPorts=new Map(imported.flatMap((component)=>component.nodes.flatMap((node)=>node.ports)).map((port)=>[port.id,port]));
  const implicitPorts=[];
  for(const node of imported.flatMap((component)=>component.nodes)){
    const expected=inputNodes.get(node.id);
    assert.equal(node.box.width,expected.width);assert.equal(node.box.height,expected.height);
    const explicitIds=new Set(expected.ports.map((port)=>port.id));
    for(const expectedPort of expected.ports){
      const actual=importedPorts.get(expectedPort.id);
      assert.ok(actual,`missing explicit imported port ${expectedPort.id}`);
      assert.equal(actual.nodeId,node.id);
      assert.equal(actual.side,expectedPort.layoutOptions['elk.port.side']);
      for(const key of ['x','y','width','height'])assert.equal(actual.box[key],expectedPort[key]);
    }
    for(const port of node.ports)if(!explicitIds.has(port.id))implicitPorts.push({nodeId:node.id,portId:port.id,
      side:port.side,box:port.box,incoming:port.incomingEdgeIds.length,outgoing:port.outgoingEdgeIds.length});
  }
  for(const edge of imported.flatMap((component)=>component.edges)){
    const expected=inputEdges.get(edge.logicalEdgeId);
    for(const role of ['source','target']){
      const actual=importedPorts.get(edge[`${role}PortId`]);
      assert.equal(actual.nodeId,expected[role]);
      const explicit=expected[`${role}EndpointKind`]==='node'?null:
        expected[`${role}EndpointId`]??expected[`${role}PortId`];
      if(explicit)assert.equal(actual.id,explicit);
    }
  }
  const boundaries=[];
  for(const [index,snapshot] of oracle.snapshots.entries()){
    assert.equal(snapshot.ordinal,index);
    const totals={nodeCount:0,edgeCount:0,layerCount:0};
    for(const component of snapshot.components){
      totals.nodeCount+=component.nodes.length;totals.edgeCount+=component.edges.length;totals.layerCount+=component.layers.length;
      const nodes=new Map(component.nodes.map((node)=>[node.id,node]));
      const ports=new Map(component.nodes.flatMap((node)=>node.ports).map((port)=>[port.id,port]));
      const edges=new Map(component.edges.map((edge)=>[edge.id,edge]));
      assert.equal(nodes.size,component.nodes.length);assert.equal(edges.size,component.edges.length);
      assert.equal(ports.size,component.nodes.reduce((sum,node)=>sum+node.ports.length,0));
      for(const layer of component.layers)for(const id of layer.nodeIds)assert.ok(nodes.has(id));
      for(const node of component.nodes){
        for(const value of Object.values(node.box))assert.ok(Number.isFinite(value));
        for(const port of node.ports){
          assert.equal(port.nodeId,node.id);
          for(const value of Object.values(port.box))assert.ok(Number.isFinite(value));
          for(const id of [...port.incomingEdgeIds,...port.outgoingEdgeIds])assert.ok(edges.has(id));
        }
      }
      for(const edge of component.edges){
        assert.ok(ports.has(edge.sourcePortId)&&ports.has(edge.targetPortId));
        const source=inputEdges.get(edge.logicalEdgeId);assert.ok(source,`unknown logical lineage ${edge.id}`);
        assert.equal(edge.physicalNetId,source.physicalNet);assert.deepEqual(edge.lineage,[edge.logicalEdgeId]);
        for(const point of [...edge.bendPoints,...edge.junctionPoints])assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
      }
    }
    assert.deepEqual(snapshot.metrics,totals);
    boundaries.push({ordinal:index,boundary:snapshot.boundary,processor:snapshot.processor.className,
      ...totals,dummies:snapshot.components.reduce((sum,component)=>sum+component.nodes.filter((node)=>node.kind==='long_edge').length,0)});
  }
  for(const required of ['imported','p1','p2','p3','p4','p5','final'])assert.ok(boundaries.some((item)=>item.boundary===required),`missing ${required}`);
  return {caseId:input.caseId,inputDigest:input.inputDigest,providerInputDigest:input.providerInputDigest,
    oracleProducer:oracle.producer,implicitPortCount:implicitPorts.length,implicitPorts,boundaries};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [oracleFile,inputFile]=process.argv.slice(2);
  if(!inputFile)throw new Error('usage: validate_captured_oracle.mjs <oracle.json> <captured-input.json>');
  const oracle=JSON.parse(await readFile(oracleFile,'utf8')),input=JSON.parse(await readFile(inputFile,'utf8'));
  const tsv=await readFile(inputFile.replace(/\.json$/,'.tsv'),'utf8');
  assert.equal(sha256(tsv.slice(tsv.indexOf('\n')+1)),input.inputDigest,'TSV/JSON digest mismatch');
  console.log(JSON.stringify(validateCapturedOracle(oracle,input)));
}
