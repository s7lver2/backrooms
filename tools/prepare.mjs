// npm "prepare": instala los hooks de git con lefthook, solo si está (en Vercel/CI de producción las devDependencies no se instalan y no hay git que enganchar).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.git')) spawnSync('npx', ['--no-install', 'lefthook', 'install'], { stdio: 'ignore', shell: true });
