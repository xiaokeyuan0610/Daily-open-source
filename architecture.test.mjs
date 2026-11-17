import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectArchitecture, historyNames, SEEDS, designRelevant } from './architecture.mjs';
import { eligible } from './daily.mjs';
import { architectureMarkdown, feishuCard, shouldDeliver, DELIVERY_FORMAT_VERSION } from './presentation.mjs';

test('architecture history includes practical, hot and architecture picks', () => {
  assert.deepEqual(historyNames({day:{projects:[{name:'a/a'}],trending:{projects:[{name:'b/b'}]},architecture:{projects:[{name:'c/c'}]}}}), ['a/a','b/b','c/c']);
});
test('architecture verifies license and recent default branch commit, excludes all history', async () => {
  const now = new Date('2026-11-17T02:00:00Z');
  const excluded = SEEDS[0];
  const queried = [];
  const result = await collectArchitecture({ now, exclude:[excluded], eligible,
    github: async (path) => {
      queried.push(path);
      if (path.endsWith('/license')) return {license:{spdx_id:'MIT'},html_url:'https://example.org/LICENSE'};
      if (path.includes('/commits?')) return [{commit:{committer:{date:now.toISOString()}},html_url:'https://example.org/commit'}];
      if (path.endsWith('/releases/latest')) return null;
      if (path.endsWith('/readme')) return {path:'README.md',content:Buffer.from('3D modeling and rendering design tool').toString('base64')};
      return {full_name:path.slice(7),html_url:'https://example.org/project',default_branch:'main'};
    },
    generate:async (candidates,count,mode) => {assert.equal(count,5);assert.equal(mode,'architecture');return candidates;}
  });
  assert.equal(result.status,'ok'); assert.equal(result.projects.length,5);
  assert.ok(!queried.some(path => path.startsWith('/repos/'+excluded)));
  assert.ok(result.projects.every(p => p.license === 'MIT' && p.commit === now.toISOString()));
});
test('architecture failure is explicit and does not block main report', async () => {
  const result=await collectArchitecture({exclude:[],github:async()=>{throw Error('unavailable');}});
  assert.equal(result.status,'unavailable');assert.deepEqual(result.projects,[]);
  assert.match(architectureMarkdown(result),/本次获取失败/);
  assert.ok(feishuCard('2026-11-17',[],'owner/repo',undefined,result));
  assert.equal(shouldDeliver({status:'sent',delivery_format_version:DELIVERY_FORMAT_VERSION}),false);
});

test('design-only rejects BIM climate and engineering tools and accepts creative tools', () => {
  for(const description of ['BIM IFC collaboration', 'Climate weather analysis', 'Building performance', 'Structural analysis']) assert.equal(designRelevant({full_name:'owner/tool',description}),false);
  assert.equal(designRelevant({full_name:'owner/tool',description:'3D parametric modeling and rendering'}),true);
  assert.equal(designRelevant({full_name:'owner/tool',description:'Application architecture developer SDK'}),false);
});
