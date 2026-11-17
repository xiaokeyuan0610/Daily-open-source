export const ARCHITECTURE_VERSION = 2;
export const ARCHITECTURE_LIMIT = 5;
export const SEEDS = ["blender/blender","FreeCAD/FreeCAD","LibreCAD/LibreCAD","openscad/openscad","nortikin/sverchok","JacquesLucke/animation_nodes","armory3d/armorpaint","LuxCoreRender/LuxCore","mitsuba-renderer/mitsuba3","GIMP/gimp","inkscape/inkscape","KDE/krita","darktable-org/darktable","RawTherapee/RawTherapee","chaiNNer-org/chaiNNer","upscayl/upscayl","Acly/krita-ai-diffusion","lllyasviel/Fooocus","Comfy-Org/ComfyUI"];

export function designRelevant(repo) {
  const text = `${repo.full_name || ""} ${repo.description || ""}`;
  if (/\bbim\b|\bifc\b|climate|weather|energy simulation|building performance|structural analysis|地理信息|气候|能耗|结构分析/i.test(text)) return false;
  return SEEDS.some(name => name.toLowerCase() === repo.full_name?.toLowerCase()) || /3d|cad|model(l)?ing|render|parametric|graphic|illustrat|paint|image|sketch|texture|建模|渲染|造型|绘图|图像|排版/i.test(text);
}

export function historyNames(history) {
  return Object.values(history).flatMap(issue => [...(issue.projects || []), ...(issue.trending?.projects || []), ...(issue.architecture?.projects || [])]).map(project => project.name);
}

export async function collectArchitecture({ github, eligible, generate, exclude, now = new Date() }) {
  const result = { version: ARCHITECTURE_VERSION, collected_at: now.toISOString(), status: 'unavailable', projects: [] };
  const seen = new Set(exclude.map(name => name.toLowerCase()));
  const candidates = [];
  try {
    const offset = Math.floor(now.getTime() / 86400000) % SEEDS.length;
    const names = [...SEEDS.slice(offset), ...SEEDS.slice(0, offset)];
    if (names.filter(name => !seen.has(name.toLowerCase())).length < 6) {
      for (const topic of ['parametric-design', '3d-modeling', 'rendering', 'vector-graphics']) {
        const response = await github(`/search/repositories?q=${encodeURIComponent(`topic:${topic} archived:false fork:false stars:>20`)}&sort=updated&per_page=10`);
        names.push(...response.items.map(repo => repo.full_name));
        await new Promise(resolve => setTimeout(resolve, 2100));
      }
    }
    for (const name of names) {
      if (candidates.length === ARCHITECTURE_LIMIT) break;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const path = `/repos/${name}`;
      const repo = await github(path, true);
      if (!repo || (repo.full_name.toLowerCase() !== name.toLowerCase() && seen.has(repo.full_name.toLowerCase()))) continue;
      seen.add(repo.full_name.toLowerCase());
      if (!designRelevant(repo)) continue;
      const license = await github(`${path}/license`, true);
      const commits = await github(`${path}/commits?per_page=1`, true);
      const commit = commits?.[0]?.commit?.committer?.date;
      if (!eligible(repo, license, commit, now.getTime())) continue;
      const release = await github(`${path}/releases/latest`, true);
      const readme = await github(`${path}/readme`, true);
      candidates.push({ name: repo.full_name, url: repo.html_url, description: repo.description,
        license: license.license.spdx_id, license_url: license.html_url, commit, commit_url: commits[0].html_url,
        release: release ? { tag: release.tag_name, date: release.published_at, url: release.html_url } : null,
        readme_url: `https://github.com/${repo.full_name}/blob/${repo.default_branch}/${readme?.path || 'README.md'}`,
        readme: readme?.content ? Buffer.from(readme.content, 'base64').toString('utf8').slice(0, 6000) : '' });
    }
    result.projects = candidates.length ? await generate(candidates, candidates.length, 'architecture') : [];
    result.status = result.projects.length ? 'ok' : 'empty';
  } catch {
    console.warn('Architecture section unavailable; main digest remains deliverable');
  }
  return result;
}
