import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

const directory = mkdtempSync(join(tmpdir(), 'pms-integration-'));
const data = join(directory, 'postgres');
const freePort = () => new Promise((resolve, reject) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
const port = await freePort();
const program = (name, args) => {
  const r = spawnSync(name, args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`${name} failed. Install PostgreSQL locally or supply TEST_DATABASE_URL for a disposable test database.`);
};
let started = false;
try {
  const databaseUrl = process.env.TEST_DATABASE_URL || `postgresql://pms_test@127.0.0.1:${port}/postgres`;
  if (!process.env.TEST_DATABASE_URL) {
    program('initdb', ['-D', data, '-U', 'pms_test', '-A', 'trust', '--no-locale']);
    program('pg_ctl', ['-D', data, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${directory}`, '-w', 'start']);
    started = true;
  } else if (!/(test|localhost|127\.0\.0\.1)/i.test(databaseUrl)) throw new Error('Use a disposable local/test database, never a production database.');
  const preview = process.argv.includes('--preview');
  const runtime = process.argv.includes('--runtime-smoke');
  const httpPort = preview ? 31987 : await freePort();
  const env = { ...process.env, DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: randomBytes(40).toString('hex'), PMS_INITIAL_PASSWORD: preview ? 'synthetic-local-preview-only' : randomBytes(24).toString('hex'), BETTER_AUTH_URL: `http://127.0.0.1:${httpPort}`, LLM_API_KEY: 'integration-only', LLM_API_BASE_URL: 'http://127.0.0.1:31988/v1', NODE_ENV: preview ? 'development' : runtime ? 'production' : 'test' };
  const args = preview ? ['--import', 'tsx', 'scripts/preview-fixture.ts'] : runtime ? ['scripts/runtime-smoke.mjs'] : ['node_modules/vitest/vitest.mjs', 'run', 'tests/integration.test.ts', '--maxWorkers=1'];
  const child = spawn(process.execPath, args, { stdio: 'inherit', env });
  process.on('SIGINT', () => child.kill('SIGTERM'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  process.exitCode = await new Promise((resolve) => { child.on('exit', (code) => resolve(code ?? 1)); });
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally {
  if (started) spawnSync('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
  rmSync(directory, { recursive: true, force: true });
}
