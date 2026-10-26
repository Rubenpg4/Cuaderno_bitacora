import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../service/server';
import { blank } from '../service/domain';
import type { Meeting, RecordItem, Task } from '../shared/model';

let app: Awaited<ReturnType<typeof startServer>>, dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-task-links-'));
  app = await startServer({ dir });
  await call('/api/create-project', {
    title: 'Dependencias',
    password: 'una contraseña de prueba',
  });
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});
async function call(path: string, data: unknown = {}) {
  const response = await fetch(`http://127.0.0.1:${app.port}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
async function task(title: string, extra: Record<string, unknown> = {}) {
  const saved = await call('/api/save', {
    kind: 'task',
    data: { ...blank('task'), title, due: '2027-06-10', ...extra },
  });
  expect(saved.status, saved.body.error).toBe(200);
  return saved.body as Task;
}
async function records() {
  return (await call('/api/snapshot')).body.records as RecordItem[];
}
const find = async (id: string) => (await records()).find((record) => record.id === id) as Task;
const taskCount = async () => (await records()).filter((record) => record.kind === 'task').length;
const prerequisite = { title: 'Preparar datos', due: '2027-06-01', priority: 'Alta' };

describe('dependencias al crear una tarea', () => {
  it('crea la tarea previa y bloquea tareas existentes en una sola operación', async () => {
    const waiting = await task('Publicar informe');
    const saved = await call('/api/save', {
      kind: 'task',
      data: { ...blank('task'), title: 'Redactar informe', due: '2027-06-05', phase: 'Diseño' },
      taskLinks: {
        newDependencies: [prerequisite],
        blocks: [{ id: waiting.id, expectedVersion: waiting.version }],
      },
    });
    expect(saved.status, saved.body.error).toBe(200);
    const main = saved.body as Task;
    expect(main.dependencyIds).toHaveLength(1);
    const created = await find(main.dependencyIds[0]);
    expect(created).toMatchObject({
      ...prerequisite,
      state: 'Por hacer',
      phase: 'Diseño',
      project: main.project,
    });
    const blocked = await find(waiting.id);
    expect(blocked.dependencyIds).toEqual([main.id]);
    expect(blocked.version).toBe(waiting.version + 1);
  });

  it('mantiene las dependencias elegidas y comparte el ámbito del subproyecto', async () => {
    const child = (await call('/api/subproject-save', { data: { title: 'API', description: '' } }))
      .body;
    const existing = await task('Diseñar contrato', { subprojectId: child.id });
    const saved = await call('/api/save', {
      kind: 'task',
      data: {
        ...blank('task'),
        title: 'Implementar contrato',
        subprojectId: child.id,
        dependencyIds: [existing.id],
      },
      taskLinks: { newDependencies: [prerequisite], blocks: [] },
    });
    expect(saved.status, saved.body.error).toBe(200);
    const [kept, createdId] = (saved.body as Task).dependencyIds;
    expect(kept).toBe(existing.id);
    expect((await find(createdId)).subprojectId).toBe(child.id);

    const general = await task('Tarea general');
    const before = await taskCount();
    const crossScope = await call('/api/save', {
      kind: 'task',
      data: { ...blank('task'), title: 'Ámbito mezclado', subprojectId: child.id },
      taskLinks: {
        newDependencies: [prerequisite],
        blocks: [{ id: general.id, expectedVersion: general.version }],
      },
    });
    expect(crossScope.status).toBe(400);
    expect(crossScope.body.error).toContain('otro ámbito');
    expect(await taskCount()).toBe(before);
    expect((await find(general.id)).version).toBe(general.version);
  });

  it('rechaza ciclos sin crear ninguna de las tareas implicadas', async () => {
    const first = await task('Primer paso');
    const second = await task('Segundo paso', { dependencyIds: [first.id] });
    const before = await taskCount();
    const cycle = await call('/api/save', {
      kind: 'task',
      data: { ...blank('task'), title: 'Paso circular', dependencyIds: [second.id] },
      taskLinks: {
        newDependencies: [prerequisite],
        blocks: [{ id: first.id, expectedVersion: first.version }],
      },
    });
    expect(cycle.status).toBe(400);
    expect(cycle.body.error).toContain('ciclo');
    expect(await taskCount()).toBe(before);
    expect((await find(first.id)).dependencyIds).toEqual([]);
  });

  it('rechaza versiones obsoletas, duplicados, tareas iniciadas y datos incompletos', async () => {
    const waiting = await task('Revisar entrega');
    await call('/api/save', {
      kind: 'task',
      data: { ...waiting, description: 'Cambio posterior' },
      id: waiting.id,
      expectedVersion: waiting.version,
    });
    const before = await taskCount();
    const attempts = [
      {
        data: { ...blank('task'), title: 'Con versión vieja' },
        taskLinks: {
          newDependencies: [prerequisite],
          blocks: [{ id: waiting.id, expectedVersion: waiting.version }],
        },
        error: 'ha cambiado',
      },
      {
        data: { ...blank('task'), title: 'Bloqueo repetido' },
        taskLinks: {
          newDependencies: [],
          blocks: [
            { id: waiting.id, expectedVersion: waiting.version + 1 },
            { id: waiting.id, expectedVersion: waiting.version + 1 },
          ],
        },
        error: 'No repitas',
      },
      {
        data: { ...blank('task'), title: 'Ya iniciada', state: 'En curso' },
        taskLinks: { newDependencies: [prerequisite], blocks: [] },
        error: 'Completa primero',
      },
      {
        data: { ...blank('task'), title: 'Previa sin título' },
        taskLinks: { newDependencies: [{ ...prerequisite, title: '  ' }], blocks: [] },
        error: 'Revisa los campos',
      },
    ];
    for (const { data, taskLinks, error } of attempts) {
      const response = await call('/api/save', { kind: 'task', data, taskLinks });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain(error);
    }
    expect(await taskCount()).toBe(before);
    const idea = await call('/api/save', {
      kind: 'idea',
      data: { ...blank('idea'), title: 'Idea' },
      taskLinks: { newDependencies: [], blocks: [] },
    });
    expect(idea.body.error).toBe('Solo las tareas admiten dependencias.');
  });

  it('añade una tarea previa nueva al editar una tarea existente', async () => {
    const existing = await task('Tarea ya creada');
    const saved = await call('/api/save', {
      kind: 'task',
      data: existing,
      id: existing.id,
      expectedVersion: existing.version,
      taskLinks: { newDependencies: [prerequisite], blocks: [] },
    });
    expect(saved.status, saved.body.error).toBe(200);
    expect(saved.body.version).toBe(existing.version + 1);
    expect((await find(saved.body.dependencyIds[0])).title).toBe(prerequisite.title);
  });

  it('aplica las mismas dependencias a la tarea de seguimiento de un acuerdo', async () => {
    const meeting = (
      await call('/api/save', {
        kind: 'meeting',
        data: {
          ...blank('meeting'),
          title: 'Reunión de seguimiento',
          agreementItems: [{ text: 'Enviar acta', requiresFollowUp: true }],
        },
      })
    ).body as Meeting;
    const waiting = await task('Cerrar acta');
    const saved = await call('/api/save-follow-up-task', {
      data: { ...blank('task'), title: 'Enviar acta' },
      meetingId: meeting.id,
      agreementId: meeting.agreementItems![0].id,
      expectedMeetingVersion: meeting.version,
      taskLinks: {
        newDependencies: [prerequisite],
        blocks: [{ id: waiting.id, expectedVersion: waiting.version }],
      },
    });
    expect(saved.status, saved.body.error).toBe(200);
    expect(saved.body.dependencyIds).toHaveLength(1);
    expect((await find(waiting.id)).dependencyIds).toEqual([saved.body.id]);
  });
});
