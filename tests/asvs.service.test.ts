import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../service/server';
import { blank } from '../service/domain';
import type { AsvsOverview } from '../shared/asvsTracking';
import { ASVS_VERSION } from '../shared/asvs';

describe('API local de verificación ASVS', () => {
  let app: Awaited<ReturnType<typeof startServer>>, directory: string;
  const password = 'contraseña sintética de la API ASVS';
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'bitacora-asvs-api-'));
    app = await startServer({ dir: directory });
  });
  afterAll(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  async function post(action: string, input: unknown = {}, token = app.token) {
    const response = await fetch(`http://127.0.0.1:${app.port}/api/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return { status: response.status, data: await response.json() };
  }
  it('autentica, valida configuración/revisión, conserva historia y rechaza acceso cruzado', async () => {
    expect((await post('asvs-list', { projectId: 'otro' }, 'inválido')).status).not.toBe(200);
    expect((await post('asvs-list', { projectId: 'otro' })).status).not.toBe(200);
    const created = await post('create-project', { title: 'API ASVS de prueba', password });
    const projectId = created.data.records.find((r: { kind: string }) => r.kind === 'project').id;
    expect((await post('asvs-list', { projectId })).data.config).toBeNull();
    const configure = {
      projectId,
      catalogVersion: ASVS_VERSION,
      expectedConfigVersion: 0,
      level: 1,
    };
    for (const invalid of [
      { level: 4 },
      { enforcement: 'obligatoria' },
      { projectId: 'otro' },
      { contextRevision: 50 },
      { catalogVersion: '4.0.3' },
    ]) {
      expect((await post('asvs-configure', { ...configure, ...invalid })).status).not.toBe(200);
    }
    const configured = await post('asvs-configure', configure);
    expect(configured.status).toBe(200);
    const overview = configured.data as AsvsOverview;
    const assessment = overview.items[0].assessment;
    const local = await post('save', {
      kind: 'entry',
      data: {
        ...blank('entry'),
        title: 'Resultado sintético',
        project: projectId,
        result: 'Prueba satisfactoria',
      },
    });
    const review = {
      projectId,
      targetId: assessment.id,
      expectedVersion: assessment.version,
      expectedConfigVersion: 1,
      state: 'Cumplido',
      applicability: 'Aplicable',
      scope: 'project',
      scopeDetail: '',
      pendingScope: '',
      note: 'Revisión de todo el alcance de pruebas',
      responsible: 'Revisor',
      method: 'Test',
      evidence: [{ recordId: local.data.id, reference: 'Resultado documentado', revision: 'v1' }],
    };
    for (const invalid of [
      { evidence: [] },
      { expectedVersion: 0 },
      { expectedConfigVersion: 0 },
      { requirementSha256: 'inventada' },
      { evidence: [{ recordId: 'otro', reference: 'Prueba', revision: 'v1' }] },
      { evidence: [{ reference: 'https://user:password@example.test/report', revision: 'v1' }] },
    ]) {
      expect((await post('asvs-review', { ...review, ...invalid })).status).not.toBe(200);
    }
    const reviewed = await post('asvs-review', review);
    expect(reviewed.status).toBe(200);
    expect(reviewed.data.summary.fulfilled).toBe(1);
    const history = await post('asvs-history', { projectId, targetId: assessment.id });
    expect(history.data.items[0].after.state).toBe('Cumplido');
    expect(history.data.items[0].after.evidence[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(history.data.items[1].after.state).toBe('Pendiente');
    const backup = await post('backup', { password });
    await post('asvs-configure', { ...configure, expectedConfigVersion: 1, level: 3 });
    const restored = await post('restore', {
      data: backup.data.data,
      password,
      confirm: 'RESTAURAR',
    });
    expect(restored.status).toBe(200);
    expect(restored.data.asvs.config.level).toBe(1);
    expect((await post('asvs-list', { projectId })).data.summary.fulfilled).toBe(1);
    await post('lock');
    expect((await post('asvs-review', review)).status).not.toBe(200);
    const reopened = await post('unlock', { projectId, password });
    expect(reopened.status).toBe(200);
    expect(reopened.data.asvs.assessments[0].state).toBe('Cumplido');
    await post('lock');
    const second = await post('create-project', { title: 'Otro cuaderno sintético', password });
    const otherId = second.data.records.find((r: { kind: string }) => r.kind === 'project').id;
    expect((await post('asvs-list', { projectId })).status).not.toBe(200);
    expect((await post('asvs-review', { ...review, projectId: otherId })).status).not.toBe(200);
    expect(
      (await post('restore', { data: backup.data.data, password, confirm: 'RESTAURAR' })).status,
    ).not.toBe(200);
    expect((await post('snapshot')).data.asvs).toBeUndefined();
  });
});
