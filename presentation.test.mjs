import test from 'node:test';
import assert from 'node:assert/strict';
import { groupProjects, brief, platformLabel, navigation, feishuCard, shouldDeliver, DELIVERY_FORMAT_VERSION } from './presentation.mjs';

const projects = [
  { name: 'ShareX/ShareX', category: '截图与屏幕录制', summary: '截图、录屏、标注和 OCR 集于一体；可以自动上传。', platform: 'Windows', url: 'https://github.com/ShareX/ShareX' },
  { name: 'owner/search', category: '本地文件搜索', summary: '搜索文档中的文字。支持离线。', platform: 'Windows、macOS、Linux', url: 'https://github.com/owner/search' },
  { name: 'owner/todo', category: '个人任务与 GTD', summary: '整理待办。', platform: '手机和电脑；提供 Android 应用', url: 'https://github.com/owner/todo' },
  { name: 'owner/music', category: '本地音乐播放器', summary: '播放本地音乐。', platform: 'Windows', url: 'https://github.com/owner/music' },
  { name: 'owner/other', category: '系统监控', summary: '查看系统状态。', platform: '待核实', url: 'https://github.com/owner/other' }
];

test('each project appears in exactly one relevant group', () => {
  const grouped = groupProjects(projects);
  assert.equal(grouped.length, 5);
  assert.equal(grouped.flatMap(group => group.projects).length, projects.length);
  assert.equal(new Set(grouped.flatMap(group => group.projects.map(project => project.name))).size, projects.length);
  assert.equal(grouped.find(group => group.label === '截图与复制').projects[0].name, 'ShareX/ShareX');
});

test('brief summaries keep first clause, bound long text, and preserve emoji', () => {
  assert.equal(brief(projects[0]), '截图、录屏、标注和 OCR 集于一体');
  assert.equal(brief(projects[1]), '搜索文档中的文字');
  assert.equal([...brief({ summary: '📸'.repeat(100) })].length, 58);
  assert.equal(platformLabel(projects[1]), 'Windows / macOS / Linux');
  assert.equal(platformLabel(projects[4]), '待核实');
});

test('card includes all projects once with short links and a full report button', () => {
  const card = feishuCard('2026-11-08', projects, 'owner/digest');
  assert.equal(card.msg_type, 'interactive');
  assert.equal(card.card.schema, '2.0');
  for (const project of projects) {
    assert.equal(card.card.body.elements.filter(element => element.content?.includes(`](${project.url})`)).length, 1);
  }
  const button = card.card.body.elements.find(element => element.tag === 'button');
  assert.equal(button.behaviors[0].default_url, 'https://github.com/owner/digest/blob/main/reports/2026-11-08.md');
  assert.ok(Buffer.byteLength(JSON.stringify(card)) < 28000);
});

test('navigation has a diagram and fallback links for each project', () => {
  const result = navigation(projects);
  assert.match(result, /```mermaid\nflowchart TB/);
  for (const project of projects) assert.ok(result.includes(`](${project.url})`));
  assert.match(result, /其他实用工具/);
});

test('old text report upgrades once and current card is not sent twice', () => {
  assert.equal(shouldDeliver({ status: 'sent' }), true);
  assert.equal(shouldDeliver({ status: 'sent', delivery_format_version: DELIVERY_FORMAT_VERSION }), false);
  assert.equal(shouldDeliver({ status: 'sending', delivery_format_version: DELIVERY_FORMAT_VERSION }), true);
  assert.equal(shouldDeliver({ status: 'prepared' }), true);
});
