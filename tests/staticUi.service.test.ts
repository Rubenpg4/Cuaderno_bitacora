import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../service/server';

let app: Awaited<ReturnType<typeof startServer>>, dir: string, uiDir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-static-ui-'));
  uiDir = mkdtempSync(join(tmpdir(), 'bitacora-static-ui-dist-'));
  writeFileSync(join(uiDir, 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
  writeFileSync(join(uiDir, 'manifest.webmanifest'), '{"name":"Bitácora"}');
  app = await startServer({ dir, uiDir });
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(uiDir, { recursive: true, force: true });
});

it('sirve el icono y el manifiesto de la app con su tipo', async () => {
  const icon = await fetch(`http://127.0.0.1:${app.port}/favicon.ico`);
  expect(icon.status).toBe(200);
  expect(icon.headers.get('content-type')).toBe('image/x-icon');
  const manifest = await fetch(`http://127.0.0.1:${app.port}/manifest.webmanifest`);
  expect(manifest.status).toBe(200);
  expect(manifest.headers.get('content-type')).toBe('application/manifest+json');
  expect(await manifest.json()).toEqual({ name: 'Bitácora' });
});
