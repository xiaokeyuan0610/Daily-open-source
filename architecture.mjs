export const ARCHITECTURE_VERSION = 1;
export const ARCHITECTURE_LIMIT = 3;
export const SEEDS = ['IfcOpenShell/IfcOpenShell', 'FreeCAD/FreeCAD', 'ladybug-tools/ladybug', 'ladybug-tools/honeybee', 'ladybug-tools/dragonfly-core', 'NREL/EnergyPlus', 'NREL/OpenStudio', 'NatLabRockies/OpenStudio', 'specklesystems/speckle-server', 'ThatOpen/engine_components', 'ThatOpen/engine_web-ifc', 'cove-tool/mesh', 'ladybug-tools/lbt-grasshopper', 'ladybug-tools/honeybee-energy', 'ladybug-tools/honeybee-radiance', 'compas-dev/compas', 'compas-dev/compas_fab', 'BlockResearchGroup/compas_tna', 'geometryprocessing/geometry-central', 'OSGeo/grass', 'qgis/QGIS', 'osmnx/osmnx', 'cityjson/cjio', 'tudelft3d/3dfier', 'tudelft3d/val3dity', 'domlysz/BlenderGIS', 'buildingSMART/IDS', 'buildingSMART/BCF-XML'];

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
      for (const topic of ['bim', 'ifc', 'building-energy', 'building-information-modeling']) {
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
