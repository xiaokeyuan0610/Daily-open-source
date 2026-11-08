import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEditorial, CATEGORIES } from './editorial.mjs';
import { validatePicks } from './daily.mjs';
import { feishuCard, featuredMarkdown, workflowLine } from './presentation.mjs';

function picks() {
  return Array.from({ length: 10 }, (_, index) => ({
    name: `owner/tool${index}`, url: `https://github.com/owner/tool${index}`, category: CATEGORIES[Math.floor(index / 2)],
    summary: '支持资料中列出的功能。', platform: 'Windows', cost: '待核实', installation: '下载官方安装包。', caution: '核对项目说明。',
    scenario: '找不到资料？输入文件中的关键词，即可查找。',
    workflow: { input: '记得文件中的关键词', action: '搜索文档内容', output: '找到需要的文件' },
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

test('rejects missing or overly long workflow steps and overly long scene descriptions', () => {
  const missing = picks(); delete missing[0].workflow.output;
  assert.throws(() => validateEditorial(missing), /workflow step: output/);
  const longStep = picks(); longStep[0].workflow.action = '字'.repeat(25);
  assert.throws(() => validateEditorial(longStep), /workflow step: action/);
  const multiline = picks(); multiline[0].workflow.input = '准备素材\n额外指令';
  assert.throws(() => validateEditorial(multiline), /workflow step: input/);
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
  assert.match(featuredMarkdown(projects), /工作流程/);
  assert.ok(!JSON.stringify(card).includes('上手门槛'));
  for (const project of projects) {
    const section = sections.find(element => element.content.includes(`](${project.url})`));
    assert.ok(section.content.includes(workflowLine(project)));
  }
});

test('workflow reads in input-action-output order and labels unverified steps', () => {
  assert.equal(workflowLine(picks()[0]), '记得文件中的关键词 → 搜索文档内容 → 找到需要的文件');
  assert.equal(workflowLine({}), '待核实 → 待核实 → 待核实');
});
