import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function mergeRule(text, rule) {
  const start = '<!-- BEGIN TECHMATION PROJECT KNOWLEDGE -->', end = '<!-- END TECHMATION PROJECT KNOWLEDGE -->';
  const a = text.indexOf(start), b = text.indexOf(end);
  if ((a < 0) !== (b < 0) || (a >= 0 && b < a)) throw new Error('The existing Techmation rule block is incomplete. Repair it before setup.');
  return a >= 0 ? `${text.slice(0, a)}${rule.trim()}${text.slice(b + end.length)}` : `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${rule.trim()}\n`;
}
export function mergeMcpConfig(text, server) {
  const header = '[mcp_servers.techmationKnowledge]';
  const existing = text.match(/^\[mcp_servers\.techmationKnowledge\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m);
  if (existing) {
    const url = existing[1].match(/^url\s*=\s*"([^"]+)"/m)?.[1];
    if (!url || url !== `${server}/mcp`) throw new Error('A different techmationKnowledge connection already exists. Review it before setup.');
    return text;
  }
  if (/^\[.*techmationKnowledge.*\]/m.test(text) || /["']?techmationKnowledge["']?\s*[.=]/m.test(text) || /^\s*["']?mcp_servers["']?\s*=/m.test(text)) throw new Error('An inline, dotted, or conflicting MCP configuration needs review before setup; it has not been changed.');
  return `${text.trimEnd()}\n\n${header}\nurl = ${JSON.stringify(`${server}/mcp`)}\nstartup_timeout_sec = 30\ntool_timeout_sec = 180\nscopes = ["mcp:read", "mcp:write", "reports:read", "reports:generate", "offline_access"]\n`;
}
async function optionalRead(file) { try { return await readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } }
export async function install({ server, home = homedir(), fetcher = fetch, codexHome = process.env.CODEX_HOME || join(home, '.codex') }) {
  const url = new URL(server);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Use the HTTPS workspace address.');
  server = server.replace(/\/$/, '');
  const response = await fetcher(`${server}/codex/manifest.json`);
  if (!response.ok) throw new Error('The onboarding bundle is unavailable.');
  const manifest = await response.json();
  const files = new Map();
  for (const item of manifest.files) {
    if (!/^[A-Za-z0-9_./-]+$/.test(item.path) || item.path.includes('..')) throw new Error('Invalid bundle path.');
    const r = await fetcher(`${server}/codex/${item.path}`);
    if (!r.ok) throw new Error('A required setup file is unavailable.');
    const content = Buffer.from(await r.arrayBuffer());
    if (createHash('sha256').update(content).digest('hex') !== item.sha256) throw new Error('The setup bundle changed during download. Retry setup.');
    files.set(item.path, content);
  }
  const required = ['global-rule.md', 'collect-project-evidence.mjs', 'skills/update-progress/SKILL.md', 'skills/document-project/SKILL.md'];
  if (required.some((name) => !files.has(name))) throw new Error('The setup bundle is incomplete.');
  await mkdir(codexHome, { recursive: true });
  const override = join(codexHome, 'AGENTS.override.md'), regular = join(codexHome, 'AGENTS.md');
  const overrideText = await optionalRead(override);
  const ruleFile = overrideText.trim() ? override : regular;
  const oldRule = await optionalRead(ruleFile), configFile = join(codexHome, 'config.toml'), oldConfig = await optionalRead(configFile);
  const newRule = mergeRule(oldRule, files.get('global-rule.md').toString('utf8'));
  const newConfig = mergeMcpConfig(oldConfig, server);
  // Complete validation/downloads before touching existing configuration.
  for (const name of ['update-progress', 'document-project']) {
    const directory = join(home, '.agents', 'skills', name);
    await mkdir(directory, { recursive: true });
    const skill = join(directory, 'SKILL.md');
    const existing = await optionalRead(skill);
    if (existing && !existing.includes('<!-- managed-by: techmation-project-knowledge -->')) throw new Error(`An existing ${name} skill needs review before setup; it has not been overwritten.`);
  }
  for (const [file, before, after] of [[ruleFile, oldRule, newRule], [configFile, oldConfig, newConfig]]) {
    if (before === after) continue;
    if (before) { try { await copyFile(file, `${file}.before-techmation`, 1); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    await writeFile(file, after, { mode: 0o600 });
  }
  for (const name of ['update-progress', 'document-project']) {
    const directory = join(home, '.agents', 'skills', name);
    await writeFile(join(directory, 'SKILL.md'), files.get(`skills/${name}/SKILL.md`));
    if (name === 'update-progress') await writeFile(join(directory, 'collect-project-evidence.mjs'), files.get('collect-project-evidence.mjs'));
  }
  return { installed: true, ruleFile, mcpServer: 'techmationKnowledge', skills: ['update-progress', 'document-project'], loginCommand: 'codex mcp login techmationKnowledge' };
}
async function main() {
  const args = process.argv.slice(2), index = args.indexOf('--server');
  if (index < 0) throw new Error('Supply --server https://pms.techmation.my');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  const result = await install({ server: args[index + 1] });
  console.log(JSON.stringify(result));
  if (args.includes('--login')) {
    const login = spawnSync('codex', ['mcp', 'login', 'techmationKnowledge'], { stdio: 'inherit', windowsHide: false });
    if (login.error || login.status !== 0) console.log('Open MCP settings in Codex desktop and sign in to techmationKnowledge. Restart Codex if the new connection is not yet visible.');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
