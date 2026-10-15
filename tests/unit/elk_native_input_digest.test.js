import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {inputDigest} from '../../src/layout/elk_native/input_digest.js';
import {inputDigest as baseline} from '../reference/elk_native/input_digest_baseline.js';

test('scalar SHA256 rounds preserve old digest and independent UTF8/block-boundary vectors',()=>{
  const messages=['','abc','模块/😀/\ud800/\udfff/\u0000/"\\',
    ...[1,55,56,57,63,64,65,119,120,127,128,129,1024,65536].map((length)=>'a'.repeat(length))];
  for(const text of messages){
    const expected=`sha256:${createHash('sha256').update(text,'utf8').digest('hex')}`;
    assert.equal(baseline(text),expected);
    assert.equal(inputDigest(text),expected);
  }
});
