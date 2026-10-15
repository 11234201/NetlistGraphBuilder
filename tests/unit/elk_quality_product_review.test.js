import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {gunzipSync} from 'node:zlib';

test('mapped review keeps complete SVG bytes and topology-chosen equal-sized canonical windows',async()=>{
  const temporary=await mkdtemp(join(tmpdir(),'h08-product-review-'));
  try{
    const input=join(temporary,'input'),output=join(temporary,'review');await mkdir(input);
    const svg='<svg viewBox="0 0 640 360"><path d="M 1 2 L 3 4"/><text>full labels</text></svg>';
    for(const id of ['mapped_small_sop001','mapped_medium_eq006','mapped_large_dp002']){
      await writeFile(join(input,`${id}.report.json`),JSON.stringify({caseId:id,reports:[]}));
      for(const [index,provider] of ['elk-layered','native-layered'].entries()){
        const graph={width:640+index,height:360,nodes:[{id:'a',kind:'cell',x:100+index,y:20,width:40,height:30},
          {id:'z',kind:'output',x:300,y:20,width:40,height:30}],edges:[{id:'az',source:'a',target:'z'}]};
        await writeFile(join(input,`${id}.${provider}.graph.json`),JSON.stringify(graph));
        await writeFile(join(input,`${id}.${provider}.svg`),svg);
      }
    }
    await promisify(execFile)(process.execPath,['tools/research/elk_phase_oracle/export_product_review.mjs',input,output]);
    const review=JSON.parse(await readFile(join(output,'review_source.json'),'utf8'));
    assert.equal(review.geometryUnchanged,true);assert.equal(review.independentFit,false);
    for(const row of review.cases){
      assert.equal(row.common.width,641);
      assert.deepEqual(row.anchors.map(anchor=>anchor.nodeId),['z','a']);
      for(const anchor of row.anchors)for(const frame of anchor.frames){assert.equal(frame.width,1800);assert.equal(frame.height,1400);}
      for(const source of row.sources)assert.equal(gunzipSync(await readFile(join(output,source.name))).toString(),svg);
    }
  }finally{await rm(temporary,{recursive:true,force:true});}
});
