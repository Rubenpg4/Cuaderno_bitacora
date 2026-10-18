import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../service/server';
import { asvsCatalog } from '../shared/asvsCatalog';

let app: Awaited<ReturnType<typeof startServer>>, dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-asvs-report-api-'));
  app = await startServer({ dir });
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});
async function post(action: string, body: unknown, bearer = app.token) {
  const res = await fetch(`http://127.0.0.1:${app.port}/api/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}
it('exporta exactamente la vista revisada y rechaza cambios, manipulación, MCP y otro cuaderno', async () => {
  const created = await post('create-project', {
    title: 'Informe API sintético',
    password: 'contraseña sintética API',
  });
  const projectId = created.data.records.find((r: { kind: string }) => r.kind === 'project').id;
  const configured = await post('asvs-configure', {
    projectId,
    catalogVersion: asvsCatalog.version,
    level: 1,
    expectedConfigVersion: 0,
  });
  const a = configured.data.items[0].assessment;
  const selection = {
    projectId,
    requirementIds: [a.reqId],
    taskIds: [],
    evidenceIds: [],
    includeOriginal: true,
  };
  const preview = await post('asvs-report-preview', selection);
  expect(preview.status).toBe(200);
  const request = { selection, reviewed: true, expectedDigest: preview.data.digest, format: 'md' };
  for (const format of ['md', 'csv']) {
    const exported = await post('asvs-report-export', { ...request, format });
    expect(exported.status).toBe(200);
    expect(Buffer.from(exported.data.data, 'base64').toString()).toBe(preview.data[format]);
    expect(exported.data.extension).toBe(format);
  }
  for (const patch of [
    { reviewed: false },
    { format: 'pdf' },
    { body: 'Contenido manipulado' },
    { expectedDigest: '0'.repeat(64) },
    { selection: { ...selection, includeOriginal: false } },
  ]) {
    expect((await post('asvs-report-export', { ...request, ...patch })).status).not.toBe(200);
  }
  expect((await post('asvs-report-preview', { ...selection, projectId: 'ajeno' })).status).not.toBe(
    200,
  );
  await post('settings', { companyAuthorized: true, universityStructure: '' });
  const grant = await post('grant', {
    provider: 'codex',
    scope: 'projects',
    projectIds: [projectId],
    canCompleteTasks: true,
  });
  expect((await post('asvs-report-preview', selection, grant.data.token)).status).toBe(401);
  expect((await post('asvs-report-export', request, grant.data.token)).status).toBe(401);
  expect((await post('export', { format: 'csv', body: '=1+1', reviewed: true })).status).not.toBe(
    200,
  );
  await post('asvs-review', {
    projectId,
    targetId: a.id,
    expectedVersion: a.version,
    expectedConfigVersion: 1,
    state: 'No cumplido',
    applicability: 'Aplicable',
    scope: 'project',
    scopeDetail: '',
    pendingScope: '',
    note: 'Hallazgo sintético',
    method: 'Prueba',
    responsible: 'Persona',
    evidence: [{ reference: 'Caso API', revision: 'r1' }],
  });
  expect((await post('asvs-report-export', request)).data.error).toMatch(/ha cambiado/);
  const updated = await post('asvs-report-preview', selection);
  expect(
    (await post('asvs-report-export', { ...request, expectedDigest: updated.data.digest })).status,
  ).toBe(200);
  await post('lock', {});
  expect((await post('asvs-report-preview', selection)).status).not.toBe(200);
  expect((await post('asvs-report-export', request)).status).not.toBe(200);
});
