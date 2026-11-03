import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await mkdir('public/codex', { recursive: true });
await cp('onboarding', 'public/codex', { recursive: true });
const paths = ['global-rule.md', 'collect-project-evidence.mjs', 'skills/update-progress/SKILL.md', 'skills/document-project/SKILL.md'];
const files = [];
for (const path of paths) files.push({ path, sha256: createHash('sha256').update(await readFile(`onboarding/${path}`)).digest('hex') });
await writeFile('public/codex/manifest.json', JSON.stringify({ version: '1.0.0', files }, null, 2));
