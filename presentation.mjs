export const DELIVERY_FORMAT_VERSION = 3;

const groups = [
  { label: '文件与资料', icon: '📁', pattern: /文件|搜索|备份|云存储|传输|PDF|文档/i },
  { label: '截图与复制', icon: '📸', pattern: /截图|录屏|录制|识别|OCR|剪贴板/i },
  { label: '任务与效率', icon: '✅', pattern: /任务|待办|GTD|笔记|写作|效率|日程/i },
  { label: '影音与阅读', icon: '🎵', pattern: /音乐|播放器|视频|照片|阅读|电子书|漫画|RSS/i },
  { label: '其他实用工具', icon: '🧰', pattern: /./ }
];

export const shortName = project => project.name.split('/').pop();
const clean = value => String(value || '待核实').replace(/[\r\n]+/g, ' ').trim();
const escapeMarkdown = value => clean(value).replace(/[\\`*_\[\]<>]/g, character => `\\${character}`);

export function groupProjects(projects) {
  return groups.map(group => ({ ...group, projects: projects.filter(project =>
    groups.find(candidate => candidate.pattern.test(project.category || '其他')) === group) }))
    .filter(group => group.projects.length);
}

export function brief(project) {
  const source = clean(project.scenario || project.summary);
  const first = source.split(/[；;。]/)[0];
  const text = first || source;
  return [...text].length > 58 ? [...text].slice(0, 57).join('') + '…' : text;
}

export function platformLabel(project) {
  const source = clean(project.platform);
  const platforms = ['Windows', 'macOS', 'Linux', 'Android', 'iOS'].filter(platform =>
    new RegExp(platform, 'i').test(source));
  if (platforms.length) return platforms.join(' / ');
  return [...source].length > 32 ? [...source].slice(0, 31).join('') + '…' : source;
}

export function shouldDeliver(issue) {
  return issue.status !== 'sent' || (issue.delivery_format_version || 1) < DELIVERY_FORMAT_VERSION;
}

export function navigation(projects) {
  const grouped = groupProjects(projects);
  const lines = ['flowchart TB', '  root["今天想解决什么问题？"]'];
  grouped.forEach((group, groupIndex) => {
    lines.push(`  root --> group${groupIndex}["${group.icon} ${group.label}"]`);
    group.projects.forEach(project => {
      const index = projects.indexOf(project);
      const label = `${shortName(project)} · ${project.category}`.replace(/["<>\r\n]/g, ' ');
      lines.push(`  group${groupIndex} --> item${index}["${label}"]`);
    });
  });
  return '## 先按需求找工具\n\n```mermaid\n' + lines.join('\n') + '\n```\n\n'
    + grouped.map(group => `**${group.icon} ${group.label}**：` + group.projects.map(project =>
      `[${escapeMarkdown(shortName(project))}](${project.url})`).join(' · ')).join('\n\n')
    + '\n\n---\n\n';
}

export function featuredMarkdown(projects) {
  const project = projects.find(candidate => candidate.is_featured);
  if (!project) return '';
  return `## 🌟 今日首选 · [${escapeMarkdown(shortName(project))}](${project.url})\n\n`
    + `> ${escapeMarkdown(project.scenario)}\n\n`
    + `**为什么先试：**${escapeMarkdown(project.recommendation_reason)}\n\n`
    + `**适用平台：**${escapeMarkdown(platformLabel(project))} ｜ **上手门槛：**${escapeMarkdown(project.effort)}\n\n---\n\n`;
}

export function feishuCard(date, projects, repository) {
  const featured = projects.find(project => project.is_featured);
  const grouped = groupProjects(projects.filter(project => project !== featured));
  const allGroups = groupProjects(projects);
  const reportUrl = `https://github.com/${repository}/blob/main/reports/${date}.md`;
  const elements = [
    { tag: 'markdown', content: `**${projects.length} 个实用工具 · 先看首选，再挑所需**\n${allGroups.map(group => `${group.icon} ${group.label} ${group.projects.length}`).join('　')}` },
    { tag: 'button', text: { tag: 'plain_text', content: '查看需求导航图与完整日报' }, type: 'primary',
      behaviors: [{ type: 'open_url', default_url: reportUrl }] }
  ];
  if (featured) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'markdown', content: `**🌟 今日首选 · [${escapeMarkdown(shortName(featured))}](${featured.url})**\n`
      + `${escapeMarkdown(brief(featured))}\n`
      + `**为什么先试：**${escapeMarkdown(featured.recommendation_reason)}\n`
      + `<font color='grey'>${escapeMarkdown(platformLabel(featured))} · ${escapeMarkdown(featured.effort || '待核实')}</font>` });
  }
  for (const group of grouped) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'markdown', content: `**${group.icon} ${group.label}**` });
    for (const project of group.projects) {
      elements.push({ tag: 'markdown', content:
        `**[${escapeMarkdown(shortName(project))}](${project.url}) · ${escapeMarkdown(project.category)}**\n`
        + `${escapeMarkdown(brief(project))}\n`
        + `<font color='grey'>${escapeMarkdown(platformLabel(project))} · ${escapeMarkdown(project.effort || '待核实')}</font>` });
    }
  }
  elements.push({ tag: 'hr' });
  elements.push({ tag: 'markdown', content: '许可证与维护日期已通过 GitHub API 核验。费用、安装方式和注意事项请看完整日报。中文介绍由 AI 辅助生成。' });
  const payload = { msg_type: 'interactive', card: { schema: '2.0',
    header: { template: 'blue',
      title: { tag: 'plain_text', content: '每日实用开源精选' },
      subtitle: { tag: 'plain_text', content: `${date} · 分类速览` } },
    body: { direction: 'vertical', elements } } };
  if (Buffer.byteLength(JSON.stringify(payload)) > 28000) throw new Error('Digest card exceeds size budget');
  return payload;
}
