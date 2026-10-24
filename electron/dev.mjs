// npm run dev: Vite dev server + Electron pointed at it
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
const p = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, RR_URL: url } });
p.on('exit', () => { server.close(); process.exit(0); });
