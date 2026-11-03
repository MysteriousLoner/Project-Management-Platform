import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
// Builds never need the production signing secret. Runtime still requires its own secret.
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build'], { stdio: 'inherit', env: { ...process.env, BETTER_AUTH_SECRET: randomBytes(40).toString('hex') } });
process.exitCode = await new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
