import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrending, collectTrending, validateHotPicks, TRENDING_URL } from './trending.mjs';
import { validatePicks } from './daily.mjs';
import { feishuCard, trendingMarkdown } from './presentation.mjs';

test('parses only repository headings and keeps source order, unknown growth stays null', () => {
  const html = '<a href="/wrong/link">navigation</a><article><h2><a href="/owner/one">one</a></h2><span>1,234 stars today</span></article><article><h2><a href="/owner/two">two</a></h2></article><article><h2><a href="/owner/one">duplicate</a></h2></article>';
  assert.deepEqual(parseTrending(html), [{ name: 'owner/one', trending_rank: 1, stars_today: 1234 }, { name: 'owner/two', trending_rank: 2, stars_today: null }]);
  assert.deepEqual(parseTrending('<h1>Access denied</h1>'), []);
});

test('AI cannot overwrite rank or growth from source', () => {
  const pick = { name: 'owner/one', category: '工具', summary: '介绍', platform: '待核实', cost: '待核实', installation: '待核实', caution: '待核实', scenario: '一个具体场景', workflow: { input: '素材', action: '执行操作', output: '结果' }, trending_rank: 999, stars_today: 9999 };
  const result = validateHotPicks(validatePicks([pick], [{ name: pick.name, trending_rank: 2, stars_today: 20 }], 1));
  assert.equal(result[0].trending_rank, 2);
  assert.equal(result[0].stars_today, 20);
  assert.equal(result[0].is_featured, false);
  assert.throws(() => validateHotPicks([{ ...pick, workflow: {} }]));
});

test('trending failure does not block practical digest and never invents rank', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try {
    const result = await collectTrending({ exclude: [], github: () => { throw Error('Unexpected API call'); } });
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.projects, []);
    const card = feishuCard('2026-11-10', [], 'owner/digest', result);
    assert.match(JSON.stringify(card), /暂时无法获取/);
    assert.match(trendingMarkdown(result), /暂时无法获取/);
    assert.equal(result.source, TRENDING_URL);
  } finally { globalThis.fetch = originalFetch; }
});

test('collector excludes current and historical picks before verification', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => '<article><h2><a href="/owner/used">used</a></h2></article>' });
  try {
    const result = await collectTrending({ exclude: ['OWNER/USED'], github: () => { throw Error('Unexpected verification'); } });
    assert.equal(result.status, 'empty');
    assert.deepEqual(result.projects, []);
  } finally { globalThis.fetch = originalFetch; }
});

test('collector verifies facts, keeps rank, and renders an extra hot section', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => '<article><h2><a href="/owner/new">new</a></h2><span>123 stars today</span></article>' });
  const calls = [];
  try {
    const result = await collectTrending({ exclude: [], eligible: () => true,
      github: async path => {
        calls.push(path);
        if (path.endsWith('/license')) return { license: { spdx_id: 'MIT' }, html_url: 'https://github.com/owner/new/blob/main/LICENSE' };
        if (path.includes('/commits?')) return [{ commit: { committer: { date: '2026-11-10T00:00:00Z' } }, html_url: 'https://github.com/owner/new/commit/example' }];
        if (path.endsWith('/releases/latest')) return null;
        if (path.endsWith('/readme')) return { path: 'README.md', content: Buffer.from('Project documentation').toString('base64') };
        return { full_name: 'owner/new', html_url: 'https://github.com/owner/new', default_branch: 'main' };
      },
      generate: async candidates => candidates.map(({ readme, ...project }) => ({ ...project, scenario: '整理材料', workflow: { input: '材料', action: '整理', output: '结果' } })) });
    assert.equal(result.status, 'ok');
    assert.equal(result.projects.length, 1);
    assert.equal(result.projects[0].stars_today, 123);
    assert.ok(calls.some(path => path.endsWith('/license')));
    const card = feishuCard('2026-11-10', [], 'owner/digest', result);
    assert.match(JSON.stringify(card), /今日新增 123 Star/);
    assert.match(trendingMarkdown(result), /许可证 MIT/);
    assert.match(trendingMarkdown(result), /无正式 Release/);
  } finally { globalThis.fetch = originalFetch; }
});
