import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
await rm('dist/runtime', { recursive: true, force: true });
await mkdir('dist/runtime', { recursive: true });
await build({ entryPoints: { 'report-worker': 'worker/report-worker.ts', 'worker-health': 'worker/health.ts', migrate: 'scripts/migrate.ts' }, outdir: 'dist/runtime', outExtension: { '.js': '.mjs' }, platform: 'node', target: 'node22', format: 'esm', bundle: true, packages: 'external', sourcemap: false });
console.log('Worker, migration commands, and Codex onboarding bundle prepared.');
