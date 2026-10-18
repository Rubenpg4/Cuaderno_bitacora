import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blank } from '../service/domain';
import { startServer } from '../service/server';
import type { Entry, Objective, Project, Task } from '../shared/model';

describe('API de trazabilidad de objetivos', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bitacora-objectives-service-'));
    app = await startServer({ dir });
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function post(action: string, data: unknown = {}) {
    const response = await fetch(`http://127.0.0.1:${app.port}/api/${action}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${app.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  }

  it('guarda, recupera, invalida y elimina un objetivo dentro del cuaderno', async () => {
    const created = await post('create-project', {
      title: 'Cuaderno de prueba',
      password: 'contraseña de cuaderno de prueba',
    });
    expect(created.status).toBe(200);
    const project = created.body.records.find(
      (item: Project) => item.kind === 'project',
    ) as Project;
    const work = (
      await post('save', {
        kind: 'task',
        data: { ...blank('task'), title: 'Prototipo', project: project.id },
      })
    ).body as Task;
    const result = (
      await post('save', {
        kind: 'entry',
        data: { ...blank('entry'), title: 'Revisión', project: project.id, result: 'Aceptado' },
      })
    ).body as Entry;
    const objective = await post('save', {
      kind: 'objective',
      data: {
        ...blank('objective'),
        title: 'Comprobar prototipo',
        project: project.id,
        links: [
          { sourceKind: 'task', sourceId: work.id, role: 'trabajo', reference: '' },
          { sourceKind: 'entry', sourceId: result.id, role: 'resultado', reference: '' },
          { sourceKind: 'entry', sourceId: result.id, role: 'evidencia', reference: 'Informe' },
        ],
        validation: {
          state: 'Validado',
          date: '2026-09-28',
          reference: 'Acta',
          responsible: 'Responsable',
          linkIds: ['id-inventado'],
        },
      },
    });
    expect(objective.status).toBe(200);
    const saved = objective.body as Objective;
    expect(saved.validation.linkIds).toEqual(saved.links.map((link) => link.id));
    expect((await post('snapshot')).body.records).toContainEqual(saved);
    const backup = await post('backup', { password: 'contraseña de copia de prueba' });
    expect(backup.status).toBe(200);

    const changed = await post('save', {
      kind: 'entry',
      id: result.id,
      expectedVersion: result.version,
      data: { ...result, result: 'Pendiente de revisar' },
    });
    expect(changed.status).toBe(200);
    const updated = (await post('snapshot')).body.records.find(
      (item: Objective) => item.id === saved.id,
    ) as Objective;
    expect(updated.validation.state).toBe('Pendiente');
    expect(updated.version).toBe(saved.version + 1);

    const restored = await post('restore', {
      data: backup.body.data,
      password: 'contraseña de copia de prueba',
      confirm: 'RESTAURAR',
    });
    expect(restored.status).toBe(200);
    expect(restored.body.records.find((item: Objective) => item.id === saved.id)).toEqual(saved);

    const removed = await post('delete-objective', {
      id: saved.id,
      expectedVersion: saved.version,
    });
    expect(removed.status).toBe(200);
    expect(
      (await post('snapshot')).body.records.some((item: Objective) => item.id === saved.id),
    ).toBe(false);
  });
});
