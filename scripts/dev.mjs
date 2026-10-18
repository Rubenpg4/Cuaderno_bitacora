import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
await import('./build-service.mjs');
const service = spawn(process.execPath, ['--import', 'tsx', 'service/server.ts'], {
  env: {
    ...process.env,
    BITACORA_DEV: '1',
    BITACORA_MCP_PATH: resolve('dist-service/mcp.cjs'),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
  windowsHide: true,
});
const lines = createInterface({ input: service.stdout });
let vite;
lines.once('line', (line) => {
  const { port, token } = JSON.parse(line);
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {
    env: {
      ...process.env,
      VITE_SERVICE_URL: `http://127.0.0.1:${port}`,
      VITE_SESSION_TOKEN: token,
    },
    stdio: 'inherit',
    windowsHide: true,
  });
});
function stop() {
  vite?.kill();
  service.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
service.on('exit', () => {
  vite?.kill();
});
