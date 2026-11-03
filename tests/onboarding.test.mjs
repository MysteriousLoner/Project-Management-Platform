import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { collect, cleanText } from '../onboarding/collect-project-evidence.mjs';
import { install, mergeMcpConfig, mergeRule } from '../onboarding/setup-codex.mjs';
const directories = [];
async function temporary() { const path = await mkdtemp(join(tmpdir(), 'pms-onboarding-')); directories.push(path); return path; }
function git(path, args, env = {}) {
  const r = spawnSync('git', ['-C', path, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`Fixture git ${args[0]} failed`); return r.stdout.trim();
}
afterEach(async () => { await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
describe('colleague setup and local evidence collection', () => {
  it('preserves existing configuration and rules and is safe to run twice', async () => {
    const home = await temporary(), codex = join(home, '.codex'); await mkdir(codex);
    const original = '# Existing preference\nmodel = "my-model"\n\n[mcp_servers.existing]\nurl = "https://existing.invalid/mcp"\n';
    await writeFile(join(codex, 'config.toml'), original);
    await writeFile(join(codex, 'AGENTS.md'), 'Ordinary guidance\n');
    await writeFile(join(codex, 'AGENTS.override.md'), 'Active override guidance\n');
    const source = ['global-rule.md', 'collect-project-evidence.mjs', 'skills/update-progress/SKILL.md', 'skills/document-project/SKILL.md'];
    const files = new Map(); for (const path of source) files.set(path, await readFile(join(process.cwd(), 'onboarding', path)));
    const manifest = { files: [...files].map(([path, bytes]) => ({ path, sha256: createHash('sha256').update(bytes).digest('hex') })) };
    const fetcher = async (url) => url.endsWith('manifest.json') ? Response.json(manifest) : new Response(files.get(url.split('/codex/')[1]));
    await install({ home, codexHome: codex, server: 'https://workspace.invalid', fetcher });
    const first = await readFile(join(codex, 'config.toml'), 'utf8');
    expect(first.startsWith(original.trimEnd())).toBe(true);
    expect(await readFile(join(codex, 'AGENTS.md'), 'utf8')).toBe('Ordinary guidance\n');
    expect((await readFile(join(codex, 'AGENTS.override.md'), 'utf8')).startsWith('Active override guidance')).toBe(true);
    await install({ home, codexHome: codex, server: 'https://workspace.invalid', fetcher });
    expect(await readFile(join(codex, 'config.toml'), 'utf8')).toBe(first);
    expect(await readFile(join(codex, 'config.toml.before-techmation'), 'utf8')).toBe(original);
  });
  it('refuses conflicting connections, incomplete rule blocks, and changed download hashes', async () => {
    expect(() => mergeMcpConfig('[mcp_servers.techmationKnowledge]\nurl = "https://another.invalid/mcp"\n', 'https://workspace.invalid')).toThrow();
    expect(() => mergeMcpConfig('mcp_servers = { existing = { url = "https://other.invalid" } }\n', 'https://workspace.invalid')).toThrow();
    expect(() => mergeMcpConfig('mcp_servers.techmationKnowledge.url = "https://other.invalid/mcp"\n', 'https://workspace.invalid')).toThrow();
    expect(() => mergeRule('<!-- BEGIN TECHMATION PROJECT KNOWLEDGE -->', 'replacement')).toThrow();
    const home = await temporary();
    await expect(install({ home, server: 'https://workspace.invalid', fetcher: async (url) => url.endsWith('manifest.json') ? Response.json({ files: [{ path: 'global-rule.md', sha256: 'incorrect' }] }) : new Response('changed') })).rejects.toThrow('changed during download');
  });
  it('collects only project messages and the configured Git author, with resumable checkpoints', async () => {
    const home = await temporary(), project = join(home, 'project'), unrelated = join(home, 'unrelated');
    await mkdir(project); await mkdir(unrelated); git(project, ['init']); git(project, ['config', 'user.name', 'Employee']); git(project, ['config', 'user.email', 'employee@fixture.invalid']);
    await writeFile(join(project, 'work.txt'), 'Own work\n'); git(project, ['add', '.']); git(project, ['commit', '-m', 'Implement own feature']);
    await writeFile(join(project, 'other.txt'), 'Other work\n'); git(project, ['add', '.']); git(project, ['commit', '-m', 'Other employee feature'], { GIT_AUTHOR_NAME: 'Another Employee', GIT_AUTHOR_EMAIL: 'another@fixture.invalid' });
    const sessions = join(home, '.codex', 'sessions'); await mkdir(sessions, { recursive: true });
    const message = (id, text, channel = 'final') => ({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', id, role: 'assistant', channel, content: [{ type: 'output_text', text }] } });
    await writeFile(join(sessions, 'project.jsonl'), [{ type: 'session_meta', payload: { id: 'project-session', cwd: project } }, message('own-message', 'Implemented a verified feature.'), message('private-thinking', 'Hidden reasoning must not be collected.', 'analysis'), { type: 'response_item', payload: { type: 'function_call_output', output: 'Never collect tool output' } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
    await writeFile(join(sessions, 'unrelated.jsonl'), [{ type: 'session_meta', payload: { id: 'unrelated-session', cwd: unrelated } }, message('unrelated-message', 'Unrelated private project')].map((x) => JSON.stringify(x)).join('\n') + '\n');
    const first = await collect({ cwd: project, home, baselineDate: '2020-01-01' });
    expect(first.evidence.some((e) => e.localText.includes('Implement own feature'))).toBe(true);
    expect(first.evidence.some((e) => e.localText.includes('Other employee feature'))).toBe(false);
    expect(first.evidence.some((e) => e.id === 'conversation-item:own-message')).toBe(true);
    expect(first.evidence.some((e) => e.id.includes('private-thinking') || e.id.includes('unrelated-message'))).toBe(false);
    const second = await collect({ cwd: project, home, baselineDate: '2020-01-01', context: { checkpoint: { sources: first.sources } } });
    expect(second.clientId).toBe(first.clientId); expect(second.evidence).toHaveLength(0);
    await writeFile(join(project, 'work.txt'), 'More own work\n'); git(project, ['add', '.']); git(project, ['commit', '-m', 'New work with an older author date'], { GIT_AUTHOR_DATE: '2025-01-01T10:00:00Z' });
    const third = await collect({ cwd: project, home, baselineDate: '2020-01-01', context: { checkpoint: { sources: first.sources } } });
    expect(third.evidence.some((e) => e.localText.includes('older author date'))).toBe(true);
  });
  it('redacts credentials from evidence text before Codex sees local excerpts', () => {
    const clean = cleanText('password=example-private-value https://name:example-private-value@example.invalid/repo {"api_key":"example-private-value"} Authorization: Bearer example-private-value');
    expect(clean.includes('example-private-value')).toBe(false);
  });
  it('isolates nested repositories, fingerprints untracked edits, and reports unavailable history', async () => {
    const home = await temporary(), project = join(home, 'project'), nested = join(project, 'nested'), codexHome = join(home, 'custom-codex');
    await mkdir(nested, { recursive: true });
    for (const repository of [project, nested]) {
      git(repository, ['init']); git(repository, ['config', 'user.name', 'Employee']); git(repository, ['config', 'user.email', 'employee@fixture.invalid']);
      await writeFile(join(repository, 'tracked.txt'), 'Initial\n'); git(repository, ['add', '.']); git(repository, ['commit', '-m', 'Initial fixture']);
    }
    const missing = await collect({ cwd: project, home, codexHome, baselineDate: '2020-01-01' });
    expect(missing.collectionGaps).toContain('The local sessions conversation store was unavailable.');
    await mkdir(join(codexHome, 'sessions'), { recursive: true });
    const conversation = (id, cwd) => [
      { type: 'session_meta', payload: { id, cwd } },
      { timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', role: 'assistant', channel: 'final', id, content: [{ type: 'output_text', text: 'Verified work.' }] } }
    ].map(JSON.stringify).join('\n') + '\n';
    await writeFile(join(codexHome, 'sessions', 'own.jsonl'), conversation('own-custom-chat', project));
    await writeFile(join(codexHome, 'sessions', 'nested.jsonl'), conversation('nested-chat', nested));
    await writeFile(join(project, 'new.txt'), 'First edit\n');
    const first = await collect({ cwd: project, home, codexHome, baselineDate: '2020-01-01' });
    expect(first.evidence.some((e) => e.id === 'conversation-item:own-custom-chat')).toBe(true);
    expect(first.evidence.some((e) => e.id === 'conversation-item:nested-chat')).toBe(false);
    expect(first.sources['conversation:nested-chat']).toBeUndefined();
    await writeFile(join(project, 'new.txt'), 'Changed content\n');
    const second = await collect({ cwd: project, home, codexHome, baselineDate: '2020-01-01', context: { checkpoint: { sources: first.sources } } });
    expect(second.evidence.filter((e) => e.kind === 'working_tree')).toHaveLength(1);
    const third = await collect({ cwd: project, home, codexHome, baselineDate: '2020-01-01', context: { checkpoint: { sources: { ...first.sources, ...second.sources } } } });
    expect(third.evidence).toHaveLength(0);
  });
});
