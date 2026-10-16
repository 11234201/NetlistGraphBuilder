import assert from 'node:assert/strict';
import test from 'node:test';
import {getPort,getConnectionPoint} from '../../src/layout/nodeGeometry.js';

test('exact terminal identity wins over another terminal raw-pin alias',()=>{
  const alias={pin:'A{1}',rawPin:'A',direction:'input',x:0,y:10};
  const exact={pin:'A',rawPin:'other',direction:'input',x:0,y:30};
  for(const ports of [[alias,exact],[exact,alias]]){
    const node={x:20,y:40,width:100,height:80,ports};
    assert.equal(getPort(node,'A','target'),exact);
    assert.deepEqual(getConnectionPoint(node,'A','target'),{x:20,y:70});
    assert.equal(getPort(node,'A{1}','target'),alias);
    assert.equal(getPort(node,'other','target'),exact);
  }
});
