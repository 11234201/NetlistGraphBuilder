import assert from 'node:assert/strict';
import test from 'node:test';
import {projectComparisonSvg} from '../../tools/research/elk_phase_oracle/export_corpus_review.mjs';

test('common-bounds review projection preserves every SVG geometry/style byte after the root',()=>{
  const source='<?xml version="1.0"?><svg class="scene" width="640" viewBox="0 0 640 360"><style>.wire{stroke:red}</style><path d="M 1 2 L 3 4"/><text>keep labels</text></svg>';
  const projected=projectComparisonSvg(source,{width:300,height:100});
  assert.match(projected,/viewBox="0 0 300 100"/);assert.match(projected,/width="720" height="360"/);
  assert.equal(projected.slice(projected.indexOf('<style>')),source.slice(source.indexOf('<style>')));
});
test('review projection rejects invalid bounds and missing geometry instead of inventing a crop',()=>{
  assert.throws(()=>projectComparisonSvg('<svg></svg>',{width:NaN,height:30}),/invalid common bounds/);
  assert.throws(()=>projectComparisonSvg('missing',{width:30,height:30}),/missing SVG root/);
});
