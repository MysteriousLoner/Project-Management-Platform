import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, readdir, realpath, lstat, readlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const digest = (s) => createHash('sha256').update(s).digest('hex');
export function cleanText(value) {
  return String(value).replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/g, '[private key removed]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, '[secret removed]')
    .replace(/(["']?(?:password|api[_-]?key|secret(?:[_-]?key)?|(?:access[_-]?)?token)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '$1[removed]')
    .replace(/(Authorization\s*[:=]\s*["']?(?:Bearer|Basic)\s+)[^\s"',;}]+/gi, '$1[removed]')
    .replace(/(https?:\/\/)[^/\s@]+@/g, '$1[credentials removed]@');
}
function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error(`Git could not complete ${args[0]}.`);
  return r.stdout.trim();
}
function samePath(a, b) { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }
function inside(child, parent) { const r = relative(parent, child); return !r || (!r.startsWith(`..${sep}`) && r !== '..' && !r.startsWith(sep) && !/^[A-Za-z]:/.test(r)); }
async function identity(home = homedir()) {
  const dir = join(home, '.agents', 'techmation'); await mkdir(dir, { recursive: true });
  const file = join(dir, 'client.json');
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const value = { clientId: randomUUID() };
    try { await writeFile(file, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); return value; }
    catch (e2) { if (e2.code === 'EEXIST') return JSON.parse(await readFile(file, 'utf8')); throw e2; }
  }
}
async function* sessionFiles(root) {
  let children;
  try { children = await readdir(root, { withFileTypes: true }); } catch (e) { if (e.code !== 'ENOENT') throw e; return; }
  for (const entry of children.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* sessionFiles(path);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield path;
  }
}
function malaysiaDate(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export async function collect({ cwd, context = {}, baselineDate, home = homedir(), codexHome = (home === homedir() && process.env.CODEX_HOME) || join(home, '.codex'), maxEvents = 200 }) {
  const root = await realpath(cwd);
  const config = await identity(home);
  const gaps = [], evidence = [], consumedSources = {};
  const sources = context.checkpoint?.sources ?? {};
  let hasMore = false;
  let worktrees = [root], email = '', remote = '', commonDirectory = null;
  try {
    const gitRoot = git(root, ['rev-parse', '--show-toplevel']);
    commonDirectory = await realpath(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    if (!samePath(gitRoot, root)) worktrees = [gitRoot];
    worktrees = git(root, ['worktree', 'list', '--porcelain']).split('\n').filter((x) => x.startsWith('worktree ')).map((x) => x.slice(9));
    email = git(root, ['config', 'user.email']);
    try { remote = git(root, ['remote', 'get-url', 'origin']).replace(/(https?:\/\/)[^/\s@]+@/g, '$1').replace(/\?.*$/, ''); } catch { /* Explicit project selection can be used without origin. */ }
    const authorEmails = new Set([email, ...(config.gitAuthorEmails ?? [])].map((x) => x.toLowerCase()));
    const gitSourceId = `git:${digest(remote || worktrees[0])}`;
    const prior = sources[gitSourceId] ? JSON.parse(sources[gitSourceId].cursor) : { frontier: [] };
    const args = ['log', '--all', '--reverse', '--topo-order', '--format=%H%x00%P%x00%aI%x00%ae%x00%s'];
    if (prior.frontier?.length) args.push('--not', ...prior.frontier);
    const records = git(root, args).split('\n').filter(Boolean);
    const frontier = new Set(prior.frontier ?? []);
    for (const line of records) {
      const [hash, parentText, timestamp, author, subject] = line.split('\0');
      if (!hash || !timestamp) continue;
      const date = malaysiaDate(timestamp);
      if (date >= baselineDate && authorEmails.has(author.toLowerCase())) {
        if (evidence.length >= maxEvents) { hasMore = true; break; }
        evidence.push({ id: `git:${hash}`, kind: 'commit', reference: hash, workDate: date, localText: cleanText(subject) });
      }
      for (const parent of parentText.split(' ')) frontier.delete(parent);
      frontier.add(hash);
    }
    consumedSources[gitSourceId] = { kind: 'git', cursor: JSON.stringify({ frontier: [...frontier] }), observedAt: new Date().toISOString() };
    if (!hasMore) for (const tree of worktrees) {
      try {
        const status = git(tree, ['status', '--porcelain=v1']);
        const diff = git(tree, ['diff', 'HEAD', '--no-ext-diff', '--no-textconv', '--stat']);
        const staged = git(tree, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--binary']);
        const unstaged = git(tree, ['diff', '--no-ext-diff', '--no-textconv', '--binary']);
        const untrackedNames = git(tree, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
        const untrackedHash = createHash('sha256');
        for (const name of untrackedNames) {
          untrackedHash.update(name);
          const path = resolve(tree, name);
          if (!inside(path, tree)) throw new Error('Untracked path is outside the worktree.');
          const stat = await lstat(path);
          if (stat.isSymbolicLink()) untrackedHash.update(await readlink(path));
          else if (stat.isFile() && inside(await realpath(path), tree)) for await (const bytes of createReadStream(path)) untrackedHash.update(bytes);
        }
        const id = `working-tree:${digest(tree)}`;
        const state = digest(status + staged + unstaged + untrackedHash.digest('hex'));
        if (status && sources[id]?.cursor !== state) {
          if (evidence.length >= maxEvents) { hasMore = true; break; }
          evidence.push({ id: `${id}:${state}`, kind: 'working_tree', reference: tree, workDate: null, localText: cleanText(`${status}\n${diff}`), attributionNeedsVerification: true, dateNeedsVerification: true });
        }
        consumedSources[id] = { kind: 'working_tree', cursor: state, observedAt: new Date().toISOString() };
      } catch { gaps.push(`A project worktree could not be inspected: ${tree}`); }
    }
  } catch { gaps.push('Git history was unavailable; its checkpoint was not advanced.'); }
  if (!hasMore) for (const store of ['sessions', 'archived_sessions']) {
    const folder = join(codexHome, store);
    try {
      if (!(await lstat(folder)).isDirectory()) throw new Error('Conversation store is unavailable.');
      for await (const file of sessionFiles(folder)) {
        if (evidence.length >= maxEvents) { hasMore = true; break; }
        const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
        let matches = false, sourceId, ordinal = 0, consumed = 0;
        try {
          for await (const line of lines) {
            ordinal++;
            let value; try { value = JSON.parse(line); } catch { gaps.push('An incomplete conversation record was not consumed.'); break; }
            if (ordinal === 1) {
              if (value.type !== 'session_meta') break;
              const meta = value.payload ?? {};
              let location = resolve(meta.cwd ?? '/unavailable-project');
              try { location = await realpath(location); } catch { /* Missing worktrees are reported through the remaining available sources. */ }
              matches = worktrees.some((tree) => inside(location, tree));
              if (!matches) break;
              // A nested independent repository is a different project, even inside this directory.
              let owner = null;
              try { owner = await realpath(git(location, ['rev-parse', '--path-format=absolute', '--git-common-dir'])); } catch {}
              if (owner && (!commonDirectory || !samePath(owner, commonDirectory))) break;
              if (commonDirectory && !owner) { gaps.push('A matching conversation project could not be verified; its checkpoint was not advanced.'); break; }
              sourceId = `conversation:${meta.id ?? meta.session_id ?? digest(file)}`;
              consumed = Number(sources[sourceId]?.cursor ?? 1);
            }
            if (!matches || ordinal <= consumed) continue;
            const payload = value.payload ?? {};
            const date = malaysiaDate(value.timestamp);
            if (value.type === 'response_item' && payload.type === 'message' && ['user', 'assistant'].includes(payload.role) && (!payload.channel || payload.channel === 'final')) {
              const text = (payload.content ?? []).filter((p) => ['input_text', 'output_text', 'text'].includes(p.type)).map((p) => p.text ?? '').join('\n');
              // Instruction envelopes, tool outputs, and hidden reasoning are not evidence.
              if (date >= baselineDate && text && !text.startsWith('# AGENTS.md instructions') && !text.startsWith('<environment_context>')) {
                if (evidence.length >= maxEvents) { hasMore = true; break; }
                evidence.push({ id: `conversation-item:${payload.id ?? digest(sourceId + ':' + ordinal + ':' + text)}`, kind: 'conversation', reference: `${sourceId}:${ordinal}`, workDate: date, localText: cleanText(text).slice(0, 6000) });
              }
            }
            consumed = ordinal;
          }
          if (sourceId) consumedSources[sourceId] = { kind: 'conversation', cursor: String(consumed), observedAt: new Date().toISOString() };
        } catch { gaps.push('A matching project conversation could not be read; its checkpoint was not advanced.'); }
        finally { lines.close(); }
        if (hasMore) break;
      }
    } catch { gaps.push(`The local ${store} conversation store was unavailable.`); }
    if (hasMore) break;
  }
  return { clientId: config.clientId, gitAuthorEmail: email, remote, baselineDate, evidence, sources: consumedSources, collectionGaps: gaps, hasMore, warning: 'Local evidence only. Upload summarized work and evidence references, never localText or raw chats.' };
}
async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  const cwd = resolve(flag('--cwd', process.cwd()));
  if (args.includes('--identity')) { const value = await identity(); let email = ''; try { email = git(cwd, ['config', 'user.email']); } catch {} console.log(JSON.stringify({ ...value, gitAuthorEmail: email })); return; }
  const baselineDate = flag('--baseline-date', '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baselineDate)) throw new Error('Supply the selected --baseline-date YYYY-MM-DD.');
  const context = flag('--context') ? JSON.parse(await readFile(flag('--context'), 'utf8')) : {};
  console.log(JSON.stringify(await collect({ cwd, context, baselineDate }), null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(cleanText(e.message)); process.exitCode = 1; });
