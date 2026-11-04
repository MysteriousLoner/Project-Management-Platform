/** Compiled artifact smoke check against the disposable database created by test-integration.mjs. */
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import assert from 'node:assert/strict';

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error('Run through test-integration.mjs --runtime-smoke.');
const base = process.env.BETTER_AUTH_URL;
const children = [];
function start(path, env = {}) {
  const child = spawn(process.execPath, [path], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ...env } });
  child.diagnostics = '';
  child.stderr.on('data', (bytes) => { child.diagnostics = (child.diagnostics + bytes.toString()).slice(-6000); });
  children.push(child); return child;
}
async function command(path) {
  const child = start(path);
  const status = await new Promise((resolve) => child.on('exit', resolve));
  if (status !== 0) {
    let diagnostics = child.diagnostics;
    for (const [name, value] of Object.entries(process.env)) if (value && /password|secret|token|key|database_url/i.test(name)) diagnostics = diagnostics.replaceAll(value, '[redacted]');
    console.error(diagnostics);
  }
  assert.equal(status, 0, `Compiled command failed: ${path}`);
}
async function waitFor(check) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if (await check()) return; } catch { /* Startup can briefly refuse connections. */ }
    await pause(250);
  }
  throw new Error('Compiled runtime did not become healthy.');
}
try {
  await command('dist/runtime/migrate.mjs');
  // A second run verifies additive migrations/account provisioning are repeatable.
  await command('dist/runtime/migrate.mjs');
  start('dist/runtime/report-worker.mjs');
  start('.next/standalone/server.js', { HOSTNAME: '127.0.0.1', PORT: new URL(base).port });
  await waitFor(async () => (await fetch(`${base}/api/health`)).ok);
  const create = await fetch(`${base}/api/first-account`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: 'Synthetic runtime employee', password: process.env.PMS_INITIAL_PASSWORD }) });
  assert.equal(create.status, 200, 'Production account creation');
  const options = await (await fetch(`${base}/api/login-options`)).json();
  const employee = options.employees[0];
  const signIn = await fetch(`${base}/api/auth/sign-in/username`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: employee.username, password: process.env.PMS_INITIAL_PASSWORD }) });
  assert.equal(signIn.status, 200, 'Production browser sign-in');
  const cookie = signIn.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
  const me = await fetch(`${base}/api/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 200, 'Production authenticated identity');
  const identity = (await me.json()).principal;
  assert.equal(identity.displayName, 'Synthetic runtime employee');
  assert.equal(identity.usingInitialPassword, true);
  const password = await fetch(`${base}/password?firstLogin=1&returnTo=%2Freports`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(password.status, 200, 'Production first-login password prompt');
  assert.ok((await password.text()).includes('Please choose a personal password before continuing.'));
  const reports = await fetch(`${base}/reports`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(reports.status, 200, 'Production report page');
  assert.equal((await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).status, 200, 'Production OAuth discovery');
  assert.equal((await fetch(`${base}/mcp`)).status, 401, 'Production MCP protection');
  await command('dist/runtime/worker-health.mjs');
  console.log('Compiled migrations, standalone app, password sign-in, OAuth discovery, MCP protection, and worker heartbeat passed.');
} finally {
  await Promise.all(children.filter((child) => child.exitCode === null).map(async (child) => {
    const exited = new Promise((resolve) => child.once('exit', resolve)); child.kill('SIGTERM'); await exited;
  }));
}
