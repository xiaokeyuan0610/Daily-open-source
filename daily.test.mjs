import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { eligible, validatePicks, completePicks, signed, markdown, today } from './daily.mjs';
import { CATEGORIES } from './editorial.mjs';

test('quality gate rejects unknown licenses, old commits, and archived repositories', () => {
  const now = Date.parse('2026-11-08T02:00:00Z');
  const license = { license: { spdx_id: 'MIT' } };
  assert.equal(eligible({}, license, '2026-11-01T00:00:00Z', now), true);
  assert.equal(eligible({ archived: true }, license, '2026-11-01T00:00:00Z', now), false);
  assert.equal(eligible({}, { license: { spdx_id: 'NOASSERTION' } }, '2026-11-01T00:00:00Z', now), false);
  assert.equal(eligible({}, license, '2020-01-01T00:00:00Z', now), false);
  assert.equal(eligible({}, license, 'bad-date', now), false);
  assert.equal(eligible({}, license, '2027-01-01T00:00:00Z', now), false);
});

test('model cannot replace verified license or invent projects', () => {
  const candidates = Array.from({ length: 10 }, (_, index) => ({ name: `owner/tool${index}`, license: 'MIT', readme: 'untrusted' }));
  const picks = candidates.map(project => ({ name: project.name, license: 'invented', category: '效率', summary: '介绍', platform: '待核实', cost: '待核实', installation: '待核实', caution: '核对安装说明' }));
  const selected = validatePicks(picks, candidates);
  assert.equal(selected[0].license, 'MIT');
  assert.equal('readme' in selected[0], false);
  assert.throws(() => validatePicks(picks.slice(1), candidates));
  assert.throws(() => validatePicks([...picks.slice(1), picks[1]], candidates));
  assert.throws(() => validatePicks([{ ...picks[0], name: 'bad/repo' }, ...picks.slice(1)], candidates));
});

test('Feishu signature uses timestamp and secret as HMAC key', () => {
  const result = signed({ msg_type: 'text' }, 'example-secret', '123');
  assert.equal(result.sign, createHmac('sha256', '123\nexample-secret').update('').digest('base64'));
  assert.deepEqual(signed({ msg_type: 'text' }), { msg_type: 'text' });
});

test('report labels commit and release dates separately', () => {
  const report = markdown('2026-11-08', [{ name: 'owner/tool', commit: '2026-11-01', release: null }]);
  assert.match(report, /默认分支最近提交：2026-11-01/);
  assert.match(report, /无正式 Release/);
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

test('a short model result gets one corrective retry without changing verified facts', async () => {
  const candidates = Array.from({ length: 10 }, (_, index) => ({ name: `owner/tool${index}`, license: 'MIT' }));
  const picks = candidates.map((project, index) => ({ ...project, license: 'invented', category: CATEGORIES[Math.floor(index / 2)], summary: '介绍', platform: '待核实', cost: '待核实', installation: '待核实', caution: '核对说明', scenario: '整理资料', recommendation_reason: '解决实际问题', is_featured: index === 0, workflow: { input: '素材', action: '整理', output: '清单' } }));
  const prompts = [];
  const result = await completePicks(candidates, async messages => {
    prompts.push(messages);
    return JSON.stringify({ projects: prompts.length === 1 ? picks.slice(0, 8) : picks });
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1][0].content, /received 8/);
  assert.equal(result.length, 10);
  assert.ok(result.every(project => project.license === 'MIT'));
});

test('two invalid outputs stop rather than send an incomplete issue', async () => {
  let attempts = 0;
  await assert.rejects(completePicks([], async () => { attempts++; return '{'; }), /still invalid after one retry: Invalid JSON/);
  assert.equal(attempts, 2);
});
