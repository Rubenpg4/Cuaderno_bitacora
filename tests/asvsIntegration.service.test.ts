import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../service/server';
import { blank } from '../service/domain';
import { ASVS_VERSION } from '../shared/asvs';
import { asvsCatalog } from '../shared/asvsCatalog';

describe('API y MCP de asociaciones y propuestas ASVS', () => {
  let directory: string, app: Awaited<ReturnType<typeof startServer>>;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'bitacora-asvs-mcp-api-'));
    app = await startServer({ dir: directory });
  });
  afterEach(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  async function post(path: string, data: unknown = {}, bearer = app.token) {
    const r = await fetch(`http://127.0.0.1:${app.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return { status: r.status, data: await r.json() };
  }
  it('expone contexto proactivo, limita autoridad y revisa el cierre completo por HTTP', async () => {
    await post('/api/lock');
    const created = await post('/api/create-project', {
      title: 'Cierre ASVS HTTP sintético',
      password: 'contraseña sintética de cierre',
    });
    const projectId = created.data.records.find((r: { kind: string }) => r.kind === 'project').id;
    await post('/api/asvs-configure', {
      projectId,
      expectedConfigVersion: 0,
      catalogVersion: ASVS_VERSION,
      level: 1,
    });
    await post('/api/settings', { companyAuthorized: true, universityStructure: '' });
    const g = (
      await post('/api/grant', {
        provider: 'codex',
        scope: 'projects',
        projectIds: [projectId],
        canCompleteTasks: false,
      })
    ).data;
    const mcp = (action: string, input: unknown) => post('/mcp', { action, input }, g.token);
    const req = asvsCatalog.requirements.find((r) => r.minLevel === 1)!;
    const work = (
      await post('/api/save', {
        kind: 'task',
        data: {
          ...blank('task'),
          project: projectId,
          title: 'Tarea de cierre HTTP',
          description: 'Requisito original',
          asvsLinks: [
            {
              catalogVersion: ASVS_VERSION,
              reqId: req.reqId,
              mandatory: true,
              reason: 'Control sintético',
              scope: 'Módulo',
              criterion: 'Entrada inválida rechazada',
              method: 'Prueba HTTP',
            },
          ],
        },
      })
    ).data;
    expect((await mcp('read', { recordIds: [work.id] })).data.items[0].asvs.enabled).toBe(true);
    const criteria = await mcp('asvs-task-criteria', { taskId: work.id });
    expect(criteria.status).toBe(200);
    expect(criteria.data.items[0].link.mandatory).toBe(true);
    const selected = (
      await post('/api/grant', { provider: 'claude', scope: 'selected', shareIds: [] })
    ).data;
    expect(
      (
        await post(
          '/mcp',
          { action: 'asvs-task-criteria', input: { taskId: work.id } },
          selected.token,
        )
      ).status,
    ).not.toBe(200);
    const review = {
      projectId,
      taskId: work.id,
      reqId: req.reqId,
      expectedTaskVersion: work.version,
      expectedVersion: 0,
      expectedConfigVersion: 1,
      state: 'Cumplido',
      applicability: 'Aplicable',
      scopeDetail: 'Módulo',
      pendingScope: 'Resto del proyecto pendiente',
      note: 'Caso observado',
      method: 'Prueba HTTP',
      responsible: 'Revisor sintético',
      evidence: [{ reference: 'tests/security.test.ts', revision: 'revisión sintética 1' }],
      rationale: 'Validación sintética',
    };
    expect((await mcp('asvs-task-propose', { ...review, mandatory: false })).status).not.toBe(200);
    expect((await mcp('asvs-task-propose', { ...review, state: 'No aplicable' })).status).not.toBe(
      200,
    );
    const asvs = (await mcp('asvs-task-propose', review)).data;
    const close = (
      await mcp('propose', {
        kind: 'task',
        operation: 'update',
        targetId: work.id,
        expectedVersion: work.version,
        patch: { state: 'Completada', solution: 'Resultado probado' },
        rationale: 'Cierre sintético',
      })
    ).data;
    const input = { taskId: work.id, closureId: close.id, checkIds: [], asvsIds: [asvs.id] };
    expect((await mcp('complete-task', input)).status).not.toBe(200);
    expect(
      (await post('/api/review', { ids: [close.id], asvsIds: [asvs.id], accept: true }, g.token))
        .status,
    ).toBe(401);
    expect(
      (await post('/api/review', { ids: [close.id], asvsIds: [asvs.id], accept: true })).status,
    ).toBe(200);
    const snapshot = (await post('/api/snapshot')).data;
    expect(snapshot.records.find((r: { id: string }) => r.id === work.id)).toMatchObject({
      state: 'Completada',
      description: work.description,
      solution: 'Resultado probado',
    });
    expect(snapshot.asvs.proposals.find((p: { id: string }) => p.id === asvs.id).status).toBe(
      'accepted',
    );
    expect((await post('/api/asvs-list', { projectId })).data.summary.fulfilled).toBe(0);
  });
  it('valida HTTP/MCP, conserva asociaciones al restaurar y limita la revisión a la sesión humana', async () => {
    const password = 'contraseña sintética servicio ASVS';
    const created = await post('/api/create-project', {
      title: 'Servicio ASVS sintético',
      password,
    });
    const projectId = created.data.records.find((r: { kind: string }) => r.kind === 'project').id;
    const configured = await post('/api/asvs-configure', {
      projectId,
      expectedConfigVersion: 0,
      catalogVersion: ASVS_VERSION,
      level: 1,
    });
    await post('/api/settings', { companyAuthorized: true, universityStructure: '' });
    const g = (
      await post('/api/grant', {
        provider: 'codex',
        scope: 'projects',
        projectIds: [projectId],
        canCompleteTasks: true,
      })
    ).data;
    const mcp = (action: string, input: unknown) => post('/mcp', { action, input }, g.token);
    expect((await mcp('asvs-query', { projectId, level: 1, limit: 2 })).data.total).toBe(70);
    expect((await mcp('asvs-query', { projectId: 'otro' })).status).not.toBe(200);
    expect((await mcp('asvs-query', { projectId, level: 4 })).status).not.toBe(200);
    expect((await mcp('asvs-configure', { projectId, level: 3 })).status).not.toBe(200);
    const a = configured.data.items[0].assessment;
    const requirement = asvsCatalog.requirements.find((r) => r.reqId === a.reqId)!;
    const link = {
      catalogVersion: ASVS_VERSION,
      reqId: a.reqId,
      reason: 'Pertinencia sintética',
      scope: 'Módulo sintético',
      criterion: 'Comportamiento comprobable',
      method: 'Prueba automatizada',
    };
    const input = {
      operation: 'create',
      kind: 'task',
      patch: {
        project: projectId,
        title: 'Tarea ASVS por HTTP',
        phase: 'Implementación',
        priority: 'Alta',
        due: '2026-11-01',
        description: 'Objetivo, contexto y criterios numerados sintéticos',
        nextStep: 'Implementar prueba',
        asvsLinks: [link],
      },
      rationale: 'Control pertinente',
    };
    const proposed = await mcp('propose', input);
    expect(proposed.status).toBe(200);
    expect((await mcp('propose', input)).data.id).toBe(proposed.data.id);
    expect((await post('/api/review', { id: proposed.data.id, accept: true })).status).toBe(200);
    const saved = (await post('/api/snapshot')).data.records.find(
      (r: { title: string }) => r.title === input.patch.title,
    );
    expect(saved.asvsLinks).toEqual([link]);
    expect(
      (await mcp('asvs-read', { projectId, references: [requirement.reqId] })).data.items[0]
        .relatedTasks[0].id,
    ).toBe(saved.id);
    expect(
      (
        await post('/api/save', {
          kind: 'task',
          id: saved.id,
          expectedVersion: saved.version,
          data: { ...saved, asvsLinks: [link, link] },
        })
      ).status,
    ).not.toBe(200);
    const source = (
      await post('/api/save', {
        kind: 'entry',
        data: {
          ...blank('entry'),
          project: projectId,
          title: 'Evidencia HTTP sintética',
          result: 'Caso verificado',
        },
      })
    ).data;
    const evaluation = {
      projectId,
      reference: requirement.canonicalRef,
      targetId: a.id,
      expectedVersion: 1,
      expectedConfigVersion: 1,
      state: 'Cumplido',
      applicability: 'Aplicable',
      scope: 'project',
      scopeDetail: '',
      pendingScope: '',
      note: 'Caso sintético observado',
      method: 'Prueba HTTP',
      responsible: 'Revisor sintético',
      evidence: [{ recordId: source.id, reference: 'Resultado local', revision: 'v1' }],
      rationale: 'Resultado de la prueba',
    };
    expect((await mcp('asvs-propose', { ...evaluation, evidence: [] })).status).not.toBe(200);
    const p = await mcp('asvs-propose', evaluation);
    expect(p.status).toBe(200);
    expect((await mcp('asvs-propose', evaluation)).data.id).toBe(p.data.id);
    expect((await post('/api/asvs-list', { projectId })).data.summary.fulfilled).toBe(0);
    expect(
      (await post('/api/asvs-review-proposals', { ids: [p.data.id], accept: true }, g.token))
        .status,
    ).toBe(401);
    expect(
      (await mcp('asvs-review-proposals', { ids: [p.data.id], accept: true })).status,
    ).not.toBe(200);
    expect(
      (await post('/api/asvs-review-proposals', { ids: [p.data.id], accept: true })).status,
    ).toBe(200);
    expect((await post('/api/asvs-list', { projectId })).data.summary.fulfilled).toBe(1);
    const backup = (await post('/api/backup', { password })).data.data;
    await post('/api/save', {
      kind: 'task',
      id: saved.id,
      expectedVersion: saved.version,
      data: { ...saved, asvsLinks: [] },
    });
    const restored = await post('/api/restore', { data: backup, password, confirm: 'RESTAURAR' });
    expect(restored.status).toBe(200);
    expect(restored.data.records.find((r: { id: string }) => r.id === saved.id).asvsLinks).toEqual([
      link,
    ]);
    expect((await mcp('asvs-query', { projectId })).status).toBe(401);
    await post('/api/lock');
    await post('/api/create-project', { title: 'Otro cuaderno sintético', password });
    expect((await post('/api/asvs-list', { projectId })).status).not.toBe(200);
    expect(
      (await post('/api/asvs-review-proposals', { ids: [p.data.id], accept: true })).status,
    ).not.toBe(200);
  });
});
