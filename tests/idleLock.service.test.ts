import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../service/server';

// Synthetic notebook; only the clock is simulated, the service timer keeps running for real.
let app: Awaited<ReturnType<typeof startServer>>, dir: string, projectId: string;
const password = 'contraseña sintética de bloqueo';
const grantPath = () => join(dir, 'mcp-grant-claude.json');
function post(path: string, data: unknown = {}, token = app.token) {
  return fetch(`http://127.0.0.1:${app.port}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
async function grant() {
  const response = await post('/api/grant', {
    provider: 'claude',
    scope: 'projects',
    projectIds: [projectId],
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { token: string };
}
async function unlock() {
  expect((await post('/api/unlock', { projectId, password })).status).toBe(200);
  await post('/api/settings', { companyAuthorized: true, universityStructure: '' });
}
/** Moves the clock forward and gives the one-second idle check time to run. */
async function advance(minutes: number) {
  if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + minutes * 60000);
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-idle-lock-'));
  app = await startServer({ dir });
  const created = await (await post('/api/create-project', { title: 'Bloqueo', password })).json();
  projectId = created.records.find((record: { kind: string }) => record.kind === 'project').id;
  await post('/api/settings', { companyAuthorized: true, universityStructure: '' });
});
afterEach(async () => {
  vi.useRealTimers();
  if (!app.domain.unlocked) await unlock();
});
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('bloqueo por inactividad configurable', () => {
  it('mantiene 15 minutos por defecto y revoca las sesiones MCP al bloquear', async () => {
    expect((await (await post('/api/snapshot')).json()).idleLock).toBeUndefined();
    const { token } = await grant();
    const session = await (await post('/mcp', { action: 'session' }, token)).json();
    expect(session.idleLockInMinutes).toBeLessThanOrEqual(15);
    await advance(14);
    expect(app.domain.unlocked).toBe(true);
    await advance(2);
    expect(app.domain.unlocked).toBe(false);
    expect(existsSync(grantPath())).toBe(false);
    expect((await post('/mcp', { action: 'session' }, token)).status).toBe(401);
  });
  it('rechaza valores fuera de la lista cerrada', async () => {
    for (const idleLock of [10, '15', 'nunca', null, 0, -5, 15.5])
      expect((await post('/api/idle-lock', { idleLock })).status, String(idleLock)).toBe(400);
    expect(app.domain.require().idleLock).toBeUndefined();
  });
  it('aplica el valor elegido y lo conserva al reabrir el cuaderno', async () => {
    const response = await post('/api/idle-lock', { idleLock: 60 });
    expect(await response.json()).toEqual({ idleLock: 60 });
    await post('/api/lock');
    await unlock();
    expect((await (await post('/api/snapshot')).json()).idleLock).toBe(60);
    const { token } = await grant();
    const session = await (await post('/mcp', { action: 'session' }, token)).json();
    expect(session.idleLockInMinutes).toBeGreaterThan(15);
    expect(session.idleLockInMinutes).toBeLessThanOrEqual(60);
    await advance(30);
    expect(app.domain.unlocked).toBe(true);
    await advance(31);
    expect(app.domain.unlocked).toBe(false);
  });
  it('con Indefinido no bloquea por inactividad, pero sí a mano', async () => {
    await post('/api/idle-lock', { idleLock: 'never' });
    const { token } = await grant();
    const session = await (await post('/mcp', { action: 'session' }, token)).json();
    expect(session).toMatchObject({ idleLockAt: null, idleLockInMinutes: null });
    await advance(24 * 60);
    expect(app.domain.unlocked).toBe(true);
    vi.useRealTimers();
    // The grant keeps its own duration, so a new one is needed after a day.
    const fresh = await grant();
    await post('/api/lock');
    expect(app.domain.unlocked).toBe(false);
    expect(existsSync(grantPath())).toBe(false);
    expect((await post('/mcp', { action: 'session' }, fresh.token)).status).toBe(401);
  });
  it('con Indefinido sigue bloqueando y revocando al cerrar el servicio', async () => {
    const isolatedDir = mkdtempSync(join(tmpdir(), 'bitacora-idle-close-'));
    const isolated = await startServer({ dir: isolatedDir });
    const call = (path: string, data: unknown = {}) =>
      fetch(`http://127.0.0.1:${isolated.port}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${isolated.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    try {
      const created = await (
        await call('/api/create-project', { title: 'Cierre', password })
      ).json();
      const id = created.records.find((record: { kind: string }) => record.kind === 'project').id;
      await call('/api/settings', { companyAuthorized: true, universityStructure: '' });
      await call('/api/idle-lock', { idleLock: 'never' });
      await call('/api/grant', { provider: 'claude', scope: 'projects', projectIds: [id] });
      const isolatedGrant = join(isolatedDir, 'mcp-grant-claude.json');
      expect(existsSync(isolatedGrant)).toBe(true);
      const domain = isolated.domain;
      await isolated.close();
      expect(domain.unlocked).toBe(false);
      expect(domain.grants.size).toBe(0);
      expect(existsSync(isolatedGrant)).toBe(false);
    } finally {
      rmSync(isolatedDir, { recursive: true, force: true });
    }
  });
});
