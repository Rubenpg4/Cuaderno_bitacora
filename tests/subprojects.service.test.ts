import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../service/server';
import { blank } from '../service/domain';

let app: Awaited<ReturnType<typeof startServer>>, dir: string, projectId: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-subprojects-http-'));
  app = await startServer({ dir });
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});
async function call(path: string, data: unknown = {}, token = app.token) {
  const response = await fetch(`http://127.0.0.1:${app.port}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}

describe('API de subproyectos', () => {
  it('gestiona el ciclo de vida y limita la sesión MCP a los ámbitos elegidos', async () => {
    const created = await call('/api/create-project', {
      title: 'Cuaderno con hijos',
      password: 'una contraseña de prueba',
    });
    projectId = created.body.records.find((r: { kind: string }) => r.kind === 'project').id;
    const api = await call('/api/subproject-save', { data: { title: 'API', description: '' } });
    expect(api.status).toBe(200);
    expect(api.body).toMatchObject({ kind: 'subproject', project: projectId, status: 'Activo' });
    const forged = await call('/api/subproject-save', {
      data: { title: 'Ajeno', project: 'otro', status: 'Archivado' },
    });
    expect(forged.status).toBe(400);
    const scopedTask = await call('/api/save', {
      kind: 'task',
      data: { ...blank('task'), title: 'En API', subprojectId: api.body.id },
    });
    expect(scopedTask.body.subprojectId).toBe(api.body.id);
    await call('/api/save', { kind: 'task', data: { ...blank('task'), title: 'General' } });

    app.domain.settings({ companyAuthorized: true, universityStructure: '' });
    const invalid = await call('/api/grant', {
      provider: 'claude',
      scope: 'projects',
      projectIds: [projectId],
      scopes: ['inexistente'],
    });
    expect(invalid.status).toBe(400);
    const grant = await call('/api/grant', {
      provider: 'claude',
      scope: 'projects',
      projectIds: [projectId],
      scopes: [api.body.id],
    });
    expect(grant.status).toBe(200);
    const session = await call('/mcp', { action: 'session' }, grant.body.token);
    expect(session.body.scopes).toEqual([{ id: api.body.id, title: 'API' }]);
    const filtered = await call(
      '/mcp',
      { action: 'filter', input: { kind: 'task', limit: 10 } },
      grant.body.token,
    );
    expect(filtered.body.items.map((item: { title: string }) => item.title)).toEqual(['En API']);

    const deleteWithContent = await call('/api/subproject-delete', {
      id: api.body.id,
      expectedVersion: api.body.version,
      confirm: 'ELIMINAR',
    });
    expect(deleteWithContent.status).toBe(400);
    expect(deleteWithContent.body.error).toContain('Archívalo');

    const archived = await call('/api/subproject-status', {
      id: api.body.id,
      expectedVersion: api.body.version,
      status: 'Archivado',
    });
    expect(archived.body.status).toBe('Archivado');
    expect((await call('/mcp', { action: 'session' }, grant.body.token)).status).toBe(401);
    const blocked = await call('/api/save', {
      kind: 'task',
      data: scopedTask.body,
      id: scopedTask.body.id,
      expectedVersion: scopedTask.body.version,
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toContain('solo lectura');

    const empty = await call('/api/subproject-save', { data: { title: 'Vacío' } });
    expect(
      (await call('/api/subproject-delete', { id: empty.body.id, expectedVersion: 1 })).status,
    ).toBe(400);
    expect(
      (
        await call('/api/subproject-delete', {
          id: empty.body.id,
          expectedVersion: 1,
          confirm: 'ELIMINAR',
        })
      ).body,
    ).toEqual({ ok: true });
  });
});
