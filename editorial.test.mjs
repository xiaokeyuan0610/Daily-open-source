import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEditorial, CATEGORIES, EFFORT_LEVELS } from './editorial.mjs';
import { validatePicks } from './daily.mjs';
import { feishuCard, featuredMarkdown } from './presentation.mjs';

function picks() {
  return Array.from({ length: 10 }, (_, index) => ({
    name: `owner/tool${index}`, url: `https://github.com/owner/tool${index}`, category: CATEGORIES[Math.floor(index / 2)],
    summary: '支持资料中列出的功能。', platform: 'Windows', cost: '待核实', installation: '下载官方安装包。', caution: '核对项目说明。',
    scenario: '找不到资料？输入文件中的关键词，即可查找。', effort: EFFORT_LEVELS[index % EFFORT_LEVELS.length],
    recommendation_reason: '使用场景明确，提供可直接下载的安装包。', is_featured: index === 0
  }));
}

test('enforces real categories, maximum two per category, exactly one featured project', () => {
  assert.equal(validateEditorial(picks()).length, 10);
  const crowded = picks(); crowded[2].category = crowded[0].category;
  assert.throws(() => validateEditorial(crowded), /More than two/);
  const invented = picks(); invented[0].category = '随意分类';
  assert.throws(() => validateEditorial(invented), /allowed list/);
  assert.throws(() => validateEditorial(picks().map(project => ({ ...project, is_featured: false }))), /exactly one/);
  const featuredTwice = picks(); featuredTwice[1].is_featured = true;
  assert.throws(() => validateEditorial(featuredTwice), /exactly one/);
});

test('rejects vague effort values and overly long scene descriptions', () => {
  const badEffort = picks(); badEffort[0].effort = '简单';
  assert.throws(() => validateEditorial(badEffort), /effort/);
  const tooLong = picks(); tooLong[0].scenario = '字'.repeat(65);
  assert.throws(() => validateEditorial(tooLong), /scenario/);
});

test('refreshing historical wording preserves verified facts but accepts new editorial fields', () => {
  const original = picks().map(project => ({ ...project, category: '旧分类', license: 'MIT', commit: '2026-11-08T00:00:00Z', readme: 'untrusted' }));
  const proposed = picks().map(project => ({ ...project, license: 'invented', commit: 'invented' }));
  const selected = validateEditorial(validatePicks(proposed, original));
  assert.equal(selected[0].license, 'MIT');
  assert.equal(selected[0].commit, original[0].commit);
  assert.equal(selected[0].category, CATEGORIES[0]);
  assert.equal('readme' in selected[0], false);
});

test('featured section appears before other projects and never duplicates its project', () => {
  const projects = picks();
  const card = feishuCard('2026-11-08', projects, 'owner/digest');
  const sections = card.card.body.elements.filter(element => element.tag === 'markdown');
  const featured = sections.findIndex(element => element.content.includes('今日首选'));
  const firstOther = sections.findIndex(element => element.content.includes('tool1]'));
  assert.ok(featured < firstOther);
  for (const project of projects) assert.equal(sections.filter(element => element.content.includes(`](${project.url})`)).length, 1);
  assert.ok(sections[featured].content.includes(projects[0].recommendation_reason));
  assert.ok(sections.every(element => !element.content.includes('undefined')));
  assert.match(featuredMarkdown(projects), /今日首选/);
  assert.match(featuredMarkdown(projects), /上手门槛/);
});
