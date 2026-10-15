import assert from 'node:assert/strict';
import test from 'node:test';
import {summarizeV8Profile} from '../../tools/research/elk_phase_oracle/summarize_v8_profile.mjs';
test('profile summary keeps sampled owning functions and removes dynamic source payloads',()=>{
  const result=summarizeV8Profile('[JavaScript]:\n ticks total nonlib name\n 12 20.0% 25.0% JS: *count data:text/javascript;base64,YWJjZA==:2:1\n[C++]:\n 2 4.0% 5.0% c++fn\n[Summary]:\n12 javascript\n[C++ entry points]:\nignore');
  assert.equal(result.javascript.length,1);assert.match(result.javascript[0],/\*count \[research module\]:2:1/);
  assert.ok(!JSON.stringify(result).includes('YWJjZA=='));assert.equal(result.summary,'[Summary]:\n12 javascript');
});
