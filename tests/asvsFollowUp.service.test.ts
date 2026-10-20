import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../service/server';
import { asvsCatalog } from '../shared/asvsCatalog';

describe('API y permisos MCP de revalidación y remediación', () => {
  let app: Awaited<ReturnType<typeof startServer>>, directory: string;
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'bitacora-asvs-follow-up-api-'));
    app = await startServer({ dir: directory });
  });
  afterAll(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  async function post(path: string, input: unknown = {}, bearer = app.token) {
    const r = await fetch(`http://127.0.0.1:${app.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return { status: r.status, data: await r.json() };
  }
  it('pagina sin notas, limita alcance y mantiene avisos propuestos pendientes hasta confirmación humana', async () => {
    const created = await post('/api/create-project', {
      title: 'API seguimiento sintética',
      password: 'contraseña sintética API',
    });
    const projectId = created.data.records.find((r: { kind: string }) => r.kind === 'project').id;
    const { data: configured } = await post('/api/asvs-configure', {
      projectId,
      catalogVersion: asvsCatalog.version,
      expectedConfigVersion: 0,
      level: 1,
    });
    await post('/api/settings', { companyAuthorized: true, universityStructure: '' });
    const { data: g } = await post('/api/grant', {
      provider: 'codex',
      scope: 'projects',
      projectIds: [projectId],
      canCompleteTasks: true,
    });
    async function mcp(action: string, input: unknown, bearer = g.token) {
      return post('/mcp', { action, input }, bearer);
    }
    const a = configured.items[0].assessment;
    expect(
      (
        await post('/api/asvs-review', {
          projectId,
          targetId: a.id,
          expectedVersion: a.version,
          expectedConfigVersion: 1,
          state: 'Cumplido',
          applicability: 'Aplicable',
          scope: 'project',
          scopeDetail: '',
          pendingScope: '',
          note: 'Nota privada HTTP sintética',
          method: 'Prueba',
          responsible: 'Revisor',
          evidence: [{ reference: 'módulo-http', revision: 'commit-1' }],
        })
      ).status,
    ).toBe(200);
    const revision = {
      projectId,
      expectedConfigVersion: 1,
      expectedVersion: 0,
      reference: 'módulo-http',
      revision: 'commit-2',
      reason: 'Cambio de código registrado',
    };
    expect((await post('/api/asvs-source-revision', revision, g.token)).status).toBe(401);
    for (const action of ['asvs-source-revision', 'asvs-catalog-update', 'asvs-revision-review'])
      expect((await mcp(action, revision)).status).not.toBe(200);
    expect((await mcp('asvs-remediation', { projectId: 'ajeno' })).status).not.toBe(200);
    expect((await mcp('asvs-remediation', { projectId, limit: 11 })).status).not.toBe(200);
    const plan = await mcp('asvs-remediation', { projectId, limit: 2 });
    expect(plan.status).toBe(200);
    expect(plan.data.items).toHaveLength(2);
    expect(plan.data.nextOffset).toBe(2);
    expect(plan.data.summary).toMatchObject({ selected: 70, fulfilled: 1, denominator: 70 });
    expect(JSON.stringify(plan.data)).not.toContain('Nota privada HTTP');
    const proposed = await mcp('asvs-revision-propose', revision);
    expect(proposed.status).toBe(200);
    expect(proposed.data.status).toBe('pending');
    expect((await post('/api/asvs-list', { projectId })).data.summary.fulfilled).toBe(1);
    expect(
      (await post('/api/asvs-revision-review', { id: proposed.data.id, accept: true }, g.token))
        .status,
    ).toBe(401);
    expect(
      (await post('/api/asvs-revision-review', { id: proposed.data.id, accept: true })).status,
    ).toBe(200);
    expect((await post('/api/asvs-list', { projectId })).data.summary).toMatchObject({
      fulfilled: 0,
      stale: 1,
    });
    expect(
      (await mcp('asvs-read', { projectId, references: [a.reqId] })).data.items[0].sourceRevisions,
    ).toEqual([{ reference: 'módulo-http', revision: 'commit-2', version: 1 }]);
    const query = (await mcp('asvs-query', { projectId, limit: 1 })).data;
    expect(query.coverage.stale).toBe(1);
    expect(query.config).not.toHaveProperty('catalogBaseline');
    expect(query.config).not.toHaveProperty('contextReason');
    const signals = await post('/api/weekly-signals');
    // ASVS keeps its own view; the weekly review does not repeat its backlog.
    expect(signals.data.some((s: { kind: string }) => s.kind === 'asvs')).toBe(false);
    const selected = await post('/api/grant', {
      provider: 'claude',
      scope: 'selected',
      shareIds: [],
    });
    expect(selected.status).not.toBe(200);
    expect((await mcp('asvs-remediation', { projectId }, 'sesión-no-autorizada')).status).not.toBe(
      200,
    );
    expect(
      (
        await post(
          '/api/asvs-catalog-preview',
          { projectId, expectedConfigVersion: 1, catalogVersion: asvsCatalog.version },
          g.token,
        )
      ).status,
    ).toBe(401);
  });
});
