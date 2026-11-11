import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { navigation, featuredMarkdown, workflowLine, trendingMarkdown, feishuCard, shouldDeliver, DELIVERY_FORMAT_VERSION } from './presentation.mjs';
import { collectTrending, validateHotPicks, HOT_PROMPT, TRENDING_VERSION } from './trending.mjs';
import { validateEditorial, EDITORIAL_PROMPT, EDITORIAL_VERSION } from './editorial.mjs';

const env = process.env;
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const required = name => { if (!env[name]) throw new Error(`Missing configuration: ${name}`); return env[name]; };
const load = async path => JSON.parse(await readFile(path, 'utf8'));
const save = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');

async function request(url, { token, body, optional404 = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error',
        signal: AbortSignal.timeout(body ? 180000 : 30000),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'daily-open-source', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new Error('Network request failed; request details suppressed'); }
    if (optional404 && response.status === 404) return null;
    if (response.ok) return response.json();
    if (!body && (response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1))); continue;
    }
    throw new Error(`Remote request failed: HTTP ${response.status}; response suppressed`);
  }
}
const github = (path, optional404 = false) => request(`https://api.github.com${path}`, { token: required('GITHUB_TOKEN'), optional404 });

export function eligible(repo, license, commit, now = Date.now()) {
  const date = Date.parse(commit);
  return !repo.archived && !repo.disabled && !repo.fork && Boolean(license?.license?.spdx_id)
    && !['NOASSERTION', 'NONE'].includes(license.license.spdx_id)
    && date <= now && now - date < 365 * 86400000;
}

async function discover(history) {
  const seen = new Set(Object.values(history).flatMap(issue => [...issue.projects, ...(issue.trending?.projects || [])].map(project => project.name.toLowerCase())));
  const candidates = new Map();
  const topicResults = [];
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const topics = ['productivity', 'desktop', 'file-manager', 'pdf', 'video', 'backup', 'note-taking', 'image', 'utility', 'rss'];
  for (const topic of topics) {
    const query = `topic:${topic} stars:>100 archived:false fork:false pushed:>${cutoff}`;
    const result = await github(`/search/repositories?q=${encodeURIComponent(query)}&sort=updated&per_page=20`);
    topicResults.push(result.items);
    await new Promise(resolve => setTimeout(resolve, 2100));
  }
  for (let position = 0; position < 20; position++) {
    for (const repositories of topicResults) {
      const repo = repositories[position];
      if (repo && !seen.has(repo.full_name.toLowerCase())) candidates.set(repo.full_name, repo);
    }
  }
  const verified = [];
  for (const candidate of candidates.values()) {
    if (verified.length >= 40) break;
    const path = `/repos/${candidate.full_name}`;
    const repo = await github(path);
    if (seen.has(repo.full_name.toLowerCase())) continue;
    const license = await github(`${path}/license`, true);
    const commits = await github(`${path}/commits?per_page=1`);
    const commit = commits[0]?.commit?.committer?.date;
    if (!eligible(repo, license, commit)) continue;
    const release = await github(`${path}/releases/latest`, true);
    const readme = await github(`${path}/readme`, true);
    verified.push({ name: repo.full_name, url: repo.html_url, description: repo.description,
      license: license.license.spdx_id, license_url: license.html_url, commit, commit_url: commits[0].html_url,
      release: release ? { tag: release.tag_name, date: release.published_at, url: release.html_url } : null,
      readme_url: `https://github.com/${repo.full_name}/blob/${repo.default_branch}/${readme?.path || 'README.md'}`,
      readme: readme?.content ? Buffer.from(readme.content, 'base64').toString('utf8').slice(0, 5000) : '' });
  }
  if (verified.length < 10) throw new Error('Fewer than 10 verified candidates; no issue generated');
  return verified;
}

export function validatePicks(picks, candidates, count = 10) {
  if (!Array.isArray(picks) || picks.length !== count) throw new Error(`AI must select exactly ${count} projects; received ${Array.isArray(picks) ? picks.length : 'no project array'}`);
  const names = new Set();
  return picks.map(pick => {
    if (!pick || typeof pick.name !== 'string') throw new Error('Missing project name');
    const project = candidates.find(candidate => candidate.name === pick.name);
    if (!project || names.has(pick.name.toLowerCase())) throw new Error('AI selected unknown or duplicate project');
    names.add(pick.name.toLowerCase());
    for (const field of ['category', 'summary', 'platform', 'cost', 'installation', 'caution']) {
      if (typeof pick[field] !== 'string' || !pick[field].trim() || pick[field].length > 500) throw new Error('Invalid AI description');
    }
    const factFields = ['name', 'url', 'description', 'license', 'license_url', 'commit', 'commit_url', 'release', 'readme_url', 'trending_rank', 'stars_today'];
    const facts = Object.fromEntries(factFields.filter(field => field in project).map(field => [field, project[field]]));
    return { ...pick, ...facts };
  });
}

export async function completePicks(candidates, complete, count = 10, hot = false) {
  const prompt = hot ? HOT_PROMPT : EDITORIAL_PROMPT;
  const requirement = `输出完整的 JSON 对象，projects 必须恰好包含 ${count} 个不同候选。输出前逐项核对数量与必填字段。`;
  let correction = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await complete([
      { role: 'system', content: `${prompt}\n${requirement}${correction}` },
      { role: 'user', content: JSON.stringify(candidates) }
    ]);
    try {
      if (typeof content !== 'string' || !content.trim()) throw new Error('AI returned no text');
      const parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      const picks = validatePicks(parsed?.projects, candidates, count);
      if (!hot) return validateEditorial(picks);
      return validateHotPicks(picks).sort((first, second) => first.trending_rank - second.trending_rank);
    } catch (error) {
      const reason = error instanceof SyntaxError ? 'Invalid JSON' : error.message;
      if (attempt === 1) throw new Error(`AI output still invalid after one retry: ${reason}`);
      console.warn(`AI output invalid; retrying once: ${reason}`);
      correction = `\n上次输出未通过校验：${reason}。请从同一候选池重新选取并返回完整结果。实用精选应至少覆盖五个真实类别、每类最多两项；不要凭空增加仓库。`;
      if (hot) correction = `\n上次输出未通过校验：${reason}。请逐一介绍全部候选，返回完整结果，不得遗漏。`;
    }
  }
}

async function generate(candidates, count = 10, hot = false) {
  const base = new URL(env.AI_BASE_URL || 'https://api.metarouters.org/v1');
  if (base.protocol !== 'https:') throw new Error('AI endpoint requires HTTPS');
  return completePicks(candidates, async messages => {
    const response = await request(`${base.href.replace(/\/$/, '')}/chat/completions`, {
      token: required('AI_API_KEY'), body: { model: env.AI_MODEL || 'gpt-6-sol', messages } });
    return response.choices?.[0]?.message?.content;
  }, count, hot);
}

export function markdown(date, projects, trending) {
  return practicalMarkdown(date, projects) + trendingMarkdown(trending);
}

function practicalMarkdown(date, projects) {
  return `# 每日实用开源精选 · ${date}\n\n10 个实用开源项目。许可证与维护日期来自 GitHub API；中文介绍由 AI 辅助生成，安装前请核对项目说明。\n\n` + featuredMarkdown(projects) + navigation(projects) + projects.map((project, index) =>
    `## ${String(index + 1).padStart(2, '0')} · [${project.name}](${project.url})\n\n分类：${project.category}\n\n> ${project.scenario || project.summary}\n\n**工作流程：**${workflowLine(project)}\n\n${project.summary}\n\n- 平台：${project.platform}\n- 费用：${project.cost}\n- 安装：${project.installation}\n- 注意：${project.caution}\n- [许可证 ${project.license}](${project.license_url})\n- [默认分支最近提交：${project.commit}](${project.commit_url})\n- 最近正式发布：${project.release ? `[${project.release.tag} · ${project.release.date}](${project.release.url})` : '无正式 Release'}\n- [安装说明](${project.readme_url})\n`).join('\n');
}

async function addTrending(issue, history) {
  if (issue.trending?.version === TRENDING_VERSION) return;
  const exclude = Object.values(history).flatMap(previous => [...previous.projects, ...(previous === issue ? [] : previous.trending?.projects || [])].map(project => project.name));
  issue.trending = await collectTrending({ github, eligible, generate, exclude: [...exclude, ...issue.projects.map(project => project.name)] });
}

async function prepare() {
  const date = today();
  const history = await load('data/history.json');
  if (history[date]) {
    const issue = history[date];
    if (issue.status === 'sending' && env.CONFIRM_RESEND !== 'true') throw new Error('Previous delivery uncertain: inspect group before updating issue');
    if (issue.editorial_version !== EDITORIAL_VERSION) {
      const candidates = [];
      for (const project of issue.projects) {
        const readme = await github(`/repos/${project.name}/readme`, true);
        candidates.push({ ...project, readme: readme?.content ? Buffer.from(readme.content, 'base64').toString('utf8').slice(0, 7000) : '' });
      }
      issue.projects = await generate(candidates);
      issue.editorial_version = EDITORIAL_VERSION;
      await save('data/history.json', history);
    }
    await addTrending(issue, history);
    await save('data/history.json', history);
    await mkdir('reports', { recursive: true });
    await writeFile(`reports/${date}.md`, markdown(date, issue.projects, issue.trending));
    console.log('Refreshed layout using existing verified projects');
    return;
  }
  required('AI_API_KEY'); required('FEISHU_WEBHOOK_URL');
  const projects = await generate(await discover(history));
  const issue = { status: 'prepared', projects, editorial_version: EDITORIAL_VERSION, generated_at: new Date().toISOString() };
  await addTrending(issue, history);
  await mkdir('reports', { recursive: true });
  await writeFile(`reports/${date}.md`, markdown(date, projects, issue.trending));
  history[date] = issue;
  await save('data/history.json', history);
}

export function signed(body, secret, timestamp = String(Math.floor(Date.now() / 1000))) {
  return secret ? { ...body, timestamp, sign: createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64') } : body;
}

async function send() {
  const date = today();
  const history = await load('data/history.json');
  const issue = history[date];
  if (!issue) throw new Error('No prepared issue today');
  if (!shouldDeliver(issue)) { console.log('Today already delivered in current layout'); return; }
  if (issue.status === 'sending' && env.CONFIRM_RESEND !== 'true') throw new Error('Previous delivery uncertain: inspect group before confirming resend');
  const url = new URL(required('FEISHU_WEBHOOK_URL'));
  if (url.protocol !== 'https:' || url.hostname !== 'open.feishu.cn' || !url.pathname.startsWith('/open-apis/bot/v2/hook/')) throw new Error('Invalid Feishu endpoint');
  const payload = feishuCard(date, issue.projects, required('GITHUB_REPOSITORY'), issue.trending);
  issue.status = 'sending';
  await save('data/history.json', history);
  const { execFileSync } = await import('node:child_process');
  if (env.GITHUB_ACTIONS === 'true') {
    execFileSync('git', ['add', 'data/history.json']);
    const { spawnSync } = await import('node:child_process');
    const diff = spawnSync('git', ['diff', '--cached', '--quiet']);
    if (diff.status === 1) execFileSync('git', ['commit', '-m', `Record delivery attempt ${date}`]);
    else if (diff.status !== 0) throw new Error('Cannot inspect delivery state changes');
    execFileSync('git', ['push']);
  }
  const result = await request(url.href, { body: signed(payload, env.FEISHU_SIGN_SECRET) });
  if ((result.code ?? result.StatusCode) !== 0) throw new Error('Feishu rejected message; response suppressed');
  issue.status = 'sent'; issue.sent_at = new Date().toISOString();
  issue.delivery_format_version = DELIVERY_FORMAT_VERSION;
  await save('data/history.json', history);
  console.log('Daily report delivered');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'prepare') await prepare();
    else if (process.argv[2] === 'send') await send();
    else throw new Error('Usage: node daily.mjs prepare|send');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
