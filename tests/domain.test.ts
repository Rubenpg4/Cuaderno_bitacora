import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Domain, blank } from '../service/domain';
import { Vault } from '../service/vault';
import {
  daysUntil,
  upcomingDateLabel,
  isIncidentResolved,
  madridDate,
  memoryReport,
  weeklyReport,
  taskCompletionDay,
  isTaskCompletedOnDay,
  areTaskDependenciesMet,
  resolveTaskMoveChange,
  snapshotCheck,
  type Task,
  type Practice,
  type Entry,
  type Incident,
  type Decision,
  type Idea,
  type Project,
  type Provider,
  type Attachment,
  type Meeting,
} from '../shared/model';
let dir: string, d: Domain;
const pass = 'una contraseña larga de prueba';
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-test-'));
  d = new Domain(new Vault(dir));
  await d.unlock(pass);
});
afterEach(() => {
  d.lock();
  rmSync(dir, { recursive: true, force: true });
});
function task(extra: Record<string, unknown> = {}) {
  return d.save('task', { ...blank('task'), title: 'Revisar arquitectura', ...extra }) as Task;
}
function practice(extra: Record<string, unknown> = {}) {
  return d.save('practice', {
    ...blank('practice'),
    title: 'No compartir secretos',
    status: 'Recomendación personal',
    ...extra,
  }) as Practice;
}
function grant(recordId: string, provider: Provider = 'claude', excerpt = 'Resumen autorizado') {
  d.settings({ companyAuthorized: true, universityStructure: 'Objetivos' });
  const sh = d.share({ recordId, provider, title: 'Título revisado', excerpt });
  const g = d.grant(provider, [sh.id]);
  return { g, sh, auth: d.authorize(g.token) };
}
describe('adjuntos cifrados y propuestas', () => {
  const markdown = { name: 'notas.md', mime: 'text/markdown', text: '# Apuntes' };

  it('añade y quita varios adjuntos en los cinco tipos, sin perderlos al reabrir', async () => {
    const kinds = ['task', 'incident', 'idea', 'decision', 'meeting'] as const;
    for (const kind of kinds) {
      const created = d.save(kind, {
        ...blank(kind),
        title: `Registro ${kind}`,
        attachments: [
          markdown,
          {
            name: 'informe.pdf',
            mime: 'application/pdf',
            data: Buffer.from('%PDF-1.4\n%%EOF').toString('base64'),
          },
        ],
      }) as Task | Incident | Idea | Decision | Meeting;
      expect(created.attachments).toHaveLength(2);
      expect(created.attachments?.[0]).toMatchObject({ size: 9, name: 'notas.md' });
      const changed = d.save(
        kind,
        { ...created, attachments: [created.attachments![1]] },
        created.id,
        created.version,
      ) as Task | Incident | Idea | Decision | Meeting;
      expect(changed.attachments).toHaveLength(1);
    }
    d.lock();
    await d.unlock(pass);
    expect(
      d.snapshot().records.filter((item) => 'attachments' in item && item.attachments?.length),
    ).toHaveLength(5);
    expect(readFileSync(d.vault.path).includes(Buffer.from('# Apuntes'))).toBe(false);
  });

  it('rechaza tipos, tamaños y contenidos que no coinciden', () => {
    for (const attachment of [
      { name: 'script.svg', mime: 'image/svg+xml', text: '<svg/>' },
      { name: 'falso.pdf', mime: 'application/pdf', text: 'hola' },
      { name: 'falso.png', mime: 'image/png', data: Buffer.from('hola').toString('base64') },
      { name: 'enorme.md', mime: 'text/markdown', text: 'x'.repeat(2 * 1024 * 1024 + 1) },
    ]) {
      expect(() => task({ attachments: [attachment] })).toThrow();
    }
  });

  it('aplica los adjuntos de una creación MCP junto al registro y descarta los rechazados', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto' });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const session = d.grant('codex', [], 'projects', [project.id]);
    const auth = d.authorize(session.token);
    for (const kind of ['task', 'incident', 'idea', 'decision', 'meeting'] as const) {
      const details =
        kind === 'task'
          ? {
              phase: 'Implementación',
              priority: 'Media',
              due: madridDate(),
              description: 'Objetivo y criterios de aceptación de la tarea.',
              nextStep: 'Revisar los adjuntos.',
            }
          : kind === 'incident' || kind === 'idea'
            ? { date: madridDate(), description: 'Descripción del registro.' }
            : {};
      const proposal = d.propose(auth, {
        operation: 'create',
        kind,
        patch: { title: `MCP ${kind}`, project: project.id, attachments: [markdown], ...details },
        rationale: 'Evidencia',
      });
      const stored = d.require().proposals.find((item) => item.id === proposal.id)!;
      expect((stored.patch.attachments as Attachment[])[0].data).toBe(
        Buffer.from('# Apuntes').toString('base64'),
      );
      if (kind === 'idea') {
        d.review(proposal.id, false);
        expect(d.snapshot().records.some((item) => item.title === `MCP ${kind}`)).toBe(false);
      } else {
        d.review(proposal.id, true);
        const created = d.snapshot().records.find((item) => item.title === `MCP ${kind}`);
        expect(created && 'attachments' in created ? created.attachments : undefined).toHaveLength(
          1,
        );
        if (kind === 'task') {
          expect(JSON.stringify(d.context(auth, { recordIds: [created!.id] }))).not.toContain(
            Buffer.from('# Apuntes').toString('base64'),
          );
        }
      }
    }
    const savedTask = d.snapshot().records.find((item) => item.title === 'MCP task')!;
    expect(() =>
      d.propose(auth, {
        operation: 'update',
        kind: 'task',
        targetId: savedTask.id,
        expectedVersion: savedTask.version,
        patch: { attachments: [markdown] },
        rationale: '',
      }),
    ).toThrow('Los adjuntos solo se pueden proponer al crear');
  });
});
describe('fechas de tareas', () => {
  it('asigna hoy por defecto y exige una fecha real al guardar', () => {
    expect(task().due).toBe(madridDate());
    expect(() => task({ due: '' })).toThrow();
    expect(() => task({ due: '2026-02-30' })).toThrow();
  });
  it('recupera tareas antiguas sin fecha al abrir y al restaurar una copia', async () => {
    const old = task({ due: '2026-09-12' });
    const state = d.require();
    (state.records.find((record) => record.id === old.id) as Task).due = '';
    (state.history.find((entry) => entry.recordId === old.id)!.after as Task).due = '';
    d.vault.save(state);
    const backup = d.vault.backup('contraseña separada de copia');
    d.lock();
    await d.unlock(pass);
    const expected = madridDate();
    expect((d.require().records.find((record) => record.id === old.id) as Task).due).toBe(expected);
    expect(
      (d.require().history.find((entry) => entry.recordId === old.id)!.after as Task).due,
    ).toBe(expected);
    const restored = await d.vault.restore(backup, 'contraseña separada de copia');
    expect((restored.records.find((record) => record.id === old.id) as Task).due).toBe(expected);
  });
  it('cuenta días de calendario aunque cambie el horario de verano', () => {
    expect(daysUntil('2026-03-30', '2026-03-28')).toBe(2);
    expect(daysUntil('2026-03-27', '2026-03-28')).toBe(-1);
  });
  it('genera etiquetas legibles para próximas tareas', () => {
    expect(upcomingDateLabel('2026-09-27', '2026-09-26')).toBe('Para mañana');
    expect(upcomingDateLabel('2026-10-02', '2026-09-26')).toBe('Viernes 2 de oct.');
    expect(upcomingDateLabel('2027-01-15', '2026-09-26')).toBe('Viernes 15 de ene. de 2027');
  });
});
describe('estado automático de Hoy', () => {
  it('inicia solo tareas visibles del día y respeta dependencias y estados finales', () => {
    const day = madridDate();
    const ready = task({ due: day });
    const dependency = task({ due: day, state: 'Por hacer' });
    const blocked = task({ due: day, dependencyIds: [dependency.id] });
    const otherDay = task({ due: '2026-12-30' });
    expect(d.startTodayTasks(day, [ready.id, blocked.id])).toHaveLength(1);
    expect((d.require().records.find((record) => record.id === ready.id) as Task).state).toBe(
      'En curso',
    );
    expect((d.require().records.find((record) => record.id === blocked.id) as Task).state).toBe(
      'Por hacer',
    );
    expect(d.startTodayTasks(day, [ready.id])).toEqual([]);
    expect(() => d.startTodayTasks(day, [otherDay.id])).toThrow('fuera del día');
  });
  it('devuelve a Por hacer las tareas en curso que dejan de aparecer en Hoy sin modificar otros estados', () => {
    const inProgress = task({ state: 'En curso' });
    const completed = task({ state: 'Completada' });
    const reviewing = task({ state: 'En revisión' });
    const todo = task({ state: 'Por hacer' });

    expect(d.stopTodayTasks([])).toEqual([]);
    const stopped = d.stopTodayTasks([inProgress.id, completed.id, reviewing.id, todo.id]);
    expect(stopped).toHaveLength(1);
    expect(stopped[0].id).toBe(inProgress.id);
    expect((stopped[0] as Task).state).toBe('Por hacer');

    const records = d.require().records;
    expect((records.find((r) => r.id === inProgress.id) as Task).state).toBe('Por hacer');
    expect((records.find((r) => r.id === completed.id) as Task).state).toBe('Completada');
    expect((records.find((r) => r.id === reviewing.id) as Task).state).toBe('En revisión');
    expect((records.find((r) => r.id === todo.id) as Task).state).toBe('Por hacer');

    expect(() => d.stopTodayTasks(['non-existent-id'])).toThrow('Tarea fuera del cuaderno activo.');
  });
  it('inicia tareas vencidas aunque no estén en Hoy y conserva su estado al salir', () => {
    const overdue = task({ due: '2020-01-01' });
    const dependency = task({ due: '2999-01-01' });
    const blocked = task({ due: '2020-01-01', dependencyIds: [dependency.id] });
    const reviewing = task({ due: '2020-01-01', state: 'En revisión' });
    const completed = task({ due: '2020-01-01', state: 'Completada' });

    expect(d.startOverdueTasks()).toHaveLength(1);
    expect((d.require().records.find((record) => record.id === overdue.id) as Task).state).toBe(
      'En curso',
    );
    expect(d.startOverdueTasks()).toEqual([]);
    expect(d.stopTodayTasks([overdue.id])).toEqual([]);
    expect((d.require().records.find((record) => record.id === blocked.id) as Task).state).toBe(
      'Por hacer',
    );
    expect((d.require().records.find((record) => record.id === reviewing.id) as Task).state).toBe(
      'En revisión',
    );
    expect((d.require().records.find((record) => record.id === completed.id) as Task).state).toBe(
      'Completada',
    );
  });
});
describe('sincronización y reactividad de estado al mover tareas', () => {
  it('retorna tareas En curso a Por hacer al mover su fecha a un día distinto al activo', () => {
    const today = madridDate();
    const future = '2099-10-15';
    const t = task({ state: 'En curso', due: today });
    const change = resolveTaskMoveChange(t, { due: future }, today);
    expect(change).toEqual({ due: future, state: 'Por hacer' });
  });
  it('conserva En curso al mover una tarea a una fecha vencida', () => {
    const t = task({ state: 'En curso', due: madridDate() });
    expect(resolveTaskMoveChange(t, { due: '2020-01-01' }, madridDate())).toEqual({
      due: '2020-01-01',
    });
  });

  it('inicia tareas Por hacer a En curso al trasladarlas a la jornada activa si sus dependencias están completadas', () => {
    const today = madridDate();
    const future = '2099-10-15';
    const t = task({ state: 'Por hacer', due: future });
    const change = resolveTaskMoveChange(t, { due: today }, today);
    expect(change).toEqual({ due: today, state: 'En curso' });
  });

  it('mantiene tareas Por hacer con dependencias pendientes al moverlas a hoy', () => {
    const today = madridDate();
    const dep = task({ state: 'Por hacer', due: today });
    const blocked = task({ state: 'Por hacer', due: '2026-10-15', dependencyIds: [dep.id] });
    const change = resolveTaskMoveChange(blocked, { due: today }, today, {
      allTasks: [dep, blocked],
    });
    expect(change).toEqual({ due: today });
    expect(change.state).toBeUndefined();
  });

  it('pasa a En curso si todas las dependencias requeridas están Completadas', () => {
    const today = madridDate();
    const dep = task({ state: 'Completada', due: today });
    const ready = task({ state: 'Por hacer', due: '2026-10-15', dependencyIds: [dep.id] });
    const change = resolveTaskMoveChange(ready, { due: today }, today, {
      allTasks: [dep, ready],
    });
    expect(change).toEqual({ due: today, state: 'En curso' });
  });

  it('no pasa a En curso si tiene una propuesta de cierre pendiente', () => {
    const today = madridDate();
    const t = task({ state: 'Por hacer', due: '2026-10-15' });
    const change = resolveTaskMoveChange(t, { due: today }, today, {
      hasPendingCompletionProposal: true,
    });
    expect(change).toEqual({ due: today });
    expect(change.state).toBeUndefined();
  });

  it('respeta estados finales como Completada y En revisión sin alterarlos al cambiar fecha', () => {
    const today = madridDate();
    const completed = task({ state: 'Completada', due: today });
    const reviewing = task({ state: 'En revisión', due: today });
    expect(resolveTaskMoveChange(completed, { due: '2026-10-20' }, today)).toEqual({
      due: '2026-10-20',
    });
    expect(resolveTaskMoveChange(reviewing, { due: today }, today)).toEqual({
      due: today,
    });
  });

  it('respeta el cambio explícito de estado ignorando la adaptación de fecha', () => {
    const today = madridDate();
    const t = task({ state: 'Por hacer', due: today });
    expect(resolveTaskMoveChange(t, { state: 'En revisión' }, today)).toEqual({
      state: 'En revisión',
    });
  });
});
describe('solución de tareas', () => {
  it('recupera tareas antiguas sin solución al abrir y restaurar una copia', async () => {
    const original = task({ description: 'Requisito original' });
    const state = d.require();
    delete (state.records.find((record) => record.id === original.id) as Partial<Task>).solution;
    delete (state.history.find((entry) => entry.recordId === original.id)!.after as Partial<Task>)
      .solution;
    d.vault.save(state);
    const backup = d.vault.backup('contraseña separada de copia');
    d.lock();
    await d.unlock(pass);
    expect(d.require().records.find((record) => record.id === original.id)).toMatchObject({
      description: 'Requisito original',
      solution: '',
    });
    expect(
      (d.require().history.find((entry) => entry.recordId === original.id)!.after as Task).solution,
    ).toBe('');
    const restored = await d.vault.restore(backup, 'contraseña separada de copia');
    expect(restored.records.find((record) => record.id === original.id)).toMatchObject({
      description: 'Requisito original',
      solution: '',
    });
  });
});
describe('dependencias de tareas', () => {
  it('impide iniciarlas hasta completar todas sus dependencias y persiste los vínculos', async () => {
    const first = task({ title: 'Preparar datos' });
    const second = task({ title: 'Revisar datos' });
    const dependent = task({ title: 'Publicar resultado', dependencyIds: [first.id, second.id] });
    expect(() =>
      d.save('task', { ...dependent, state: 'En curso' }, dependent.id, dependent.version),
    ).toThrow('Completa primero');
    const completedFirst = d.save(
      'task',
      { ...first, state: 'Completada' },
      first.id,
      first.version,
    ) as Task;
    expect(() =>
      d.save('task', { ...dependent, state: 'En curso' }, dependent.id, dependent.version),
    ).toThrow('Completa primero');
    d.save('task', { ...second, state: 'Completada' }, second.id, second.version);
    const started = d.save(
      'task',
      { ...dependent, state: 'En curso' },
      dependent.id,
      dependent.version,
    ) as Task;
    expect(started.dependencyIds).toEqual([completedFirst.id, second.id]);
    d.lock();
    await d.unlock(pass);
    expect((d.require().records.find((r) => r.id === dependent.id) as Task).dependencyIds).toEqual([
      first.id,
      second.id,
    ]);
  });
  it('rechaza vínculos inexistentes, duplicados y ciclos', () => {
    const first = task();
    const second = task({ dependencyIds: [first.id] });
    expect(() => task({ dependencyIds: ['missing'] })).toThrow('no existe');
    expect(() => task({ dependencyIds: [first.id, first.id] })).toThrow('repitas');
    expect(() =>
      d.save('task', { ...first, dependencyIds: [second.id] }, first.id, first.version),
    ).toThrow('ciclo');
    expect(() =>
      d.save('task', { ...first, dependencyIds: [first.id] }, first.id, first.version),
    ).toThrow('ciclo');
  });
  it('migra tareas antiguas y elimina referencias al borrar la tarea previa', async () => {
    const first = task();
    const dependent = task({ dependencyIds: [first.id] });
    const state = d.require();
    delete (state.records.find((r) => r.id === first.id) as Partial<Task>).dependencyIds;
    d.vault.save(state);
    d.lock();
    await d.unlock(pass);
    expect((d.require().records.find((r) => r.id === first.id) as Task).dependencyIds).toEqual([]);
    d.deleteTask(first.id, first.version);
    expect((d.require().records.find((r) => r.id === dependent.id) as Task).dependencyIds).toEqual(
      [],
    );
  });
});
describe('historial de versiones de tareas', () => {
  it('restaura una versión antigua, conserva las posteriores y persiste la nueva', async () => {
    const created = task({ description: 'Borrador inicial' });
    let current = created;
    for (let index = 2; index <= 15; index++)
      current = d.save(
        'task',
        { ...current, description: `Revisión ${index}` },
        current.id,
        current.version,
      ) as Task;
    const original = d
      .require()
      .history.find((entry) => entry.recordId === created.id && entry.after.version === 1)!;
    const restored = d.restoreTask(original.id, created.id, current.version) as Task;
    expect(restored).toMatchObject({
      id: created.id,
      version: 16,
      description: 'Borrador inicial',
    });
    expect(d.require().history.filter((entry) => entry.recordId === created.id)).toHaveLength(16);
    expect(d.require().history[0]).toMatchObject({
      actor: 'Restauración de v1',
      before: { version: 15 },
      after: { version: 16 },
    });
    expect(() => d.restoreTask(original.id, created.id, current.version)).toThrow('Conflicto');
    d.lock();
    await d.unlock(pass);
    expect(
      (d.require().records.find((record) => record.id === created.id) as Task).description,
    ).toBe('Borrador inicial');
  });

  it('recupera el estado y las verificaciones históricas de una tarea completada', () => {
    const policy = practice({ mandatory: true });
    const created = task();
    const completed = d.save(
      'task',
      {
        ...created,
        state: 'Completada',
        checks: created.checks.map((check) => ({
          ...check,
          state: 'Cumplido',
          note: 'Evidencia revisada',
        })),
      },
      created.id,
      created.version,
    ) as Task;
    const reopened = d.save(
      'task',
      { ...completed, state: 'En curso' },
      completed.id,
      completed.version,
    ) as Task;
    const version = d
      .require()
      .history.find(
        (entry) => entry.recordId === created.id && entry.after.version === completed.version,
      )!;
    d.save('practice', { ...policy, title: 'Política revisada' }, policy.id, policy.version);
    const restored = d.restoreTask(version.id, created.id, reopened.version) as Task;
    expect(restored.state).toBe('Completada');
    expect(restored.completedAt).toBe(completed.completedAt);
    expect(restored.checks.find((check) => check.practiceId === policy.id)).toMatchObject({
      practiceVersion: policy.version,
      title: policy.title,
      state: 'Cumplido',
      note: 'Evidencia revisada',
    });
  });

  it('rechaza referencias ajenas y versiones que incumplen las dependencias actuales', () => {
    const prerequisite = task({ title: 'Preparar' });
    const dependent = task({ dependencyIds: [prerequisite.id] });
    const completed = d.save(
      'task',
      { ...prerequisite, state: 'Completada' },
      prerequisite.id,
      prerequisite.version,
    ) as Task;
    const started = d.save(
      'task',
      { ...dependent, state: 'En curso' },
      dependent.id,
      dependent.version,
    ) as Task;
    const pending = d.save(
      'task',
      { ...completed, state: 'Por hacer' },
      completed.id,
      completed.version,
    ) as Task;
    const history = d
      .require()
      .history.find(
        (entry) => entry.recordId === dependent.id && entry.after.version === started.version,
      )!;
    const reset = d.save(
      'task',
      { ...started, state: 'Por hacer' },
      started.id,
      started.version,
    ) as Task;
    expect(() => d.restoreTask(history.id, pending.id, pending.version)).toThrow(
      'Versión no encontrada',
    );
    expect(() => d.restoreTask(history.id, reset.id, reset.version)).toThrow('Completa primero');
    expect((d.require().records.find((record) => record.id === reset.id) as Task).version).toBe(
      reset.version,
    );
  });
});
describe('cifrado y recuperación', () => {
  it('no deja títulos ni SQLite en disco y persiste al reabrir', async () => {
    task({ title: 'SECRETO-DE-EMPRESA-9273' });
    const bytes = readFileSync(d.vault.path).toString();
    expect(bytes).not.toContain('SECRETO-DE-EMPRESA');
    expect(bytes).not.toContain('SQLite format');
    d.lock();
    await d.unlock(pass);
    expect(d.require().records.some((r) => r.title === 'SECRETO-DE-EMPRESA-9273')).toBe(true);
    expect(() => task({ title: 'NUEVA TAREA TRAS REABRIR' })).not.toThrow();
    expect(d.require().records.some((r) => r.title === 'NUEVA TAREA TRAS REABRIR')).toBe(true);
  });
  it('rechaza contraseña incorrecta sin abrir los datos', async () => {
    d.lock();
    await expect(d.unlock('incorrecta')).rejects.toThrow();
    expect(d.unlocked).toBe(false);
  });
  it('restaura una copia con otra contraseña y reinicia la autorización externa', async () => {
    const t = task();
    grant(t.id);
    const backup = d.vault.backup('contraseña separada de copia');
    task({ title: 'Posterior a la copia' });
    const restored = await d.vault.restore(backup, 'contraseña separada de copia');
    expect(restored.records.some((r) => r.title === 'Posterior a la copia')).toBe(false);
    expect(restored.settings.companyAuthorized).toBe(false);
    expect(restored.grants).toEqual([]);
  });
  it('detecta manipulación de una copia', async () => {
    const b = JSON.parse(d.vault.backup(pass).toString());
    b.data = b.data.slice(0, -4) + 'AAAA';
    await expect(d.vault.restore(Buffer.from(JSON.stringify(b)), pass)).rejects.toThrow();
  });
});
describe('incidencias', () => {
  it('conserva la fecha de aparición y vincula una resolución posterior', async () => {
    const incident = d.save('incident', {
      ...blank('incident'),
      title: 'Fallo al validar',
      date: '2026-09-12',
      description: 'La validación falla',
    });
    expect(incident.kind).toBe('incident');
    const resolved = d.save(
      'incident',
      { ...incident, solution: 'Corregir la configuración', resolvedDate: '2026-09-14' },
      incident.id,
      incident.version,
    );
    expect(resolved).toMatchObject({ date: '2026-09-12', resolvedDate: '2026-09-14' });
    d.lock();
    await d.unlock(pass);
    expect(d.require().records.find((record) => record.id === incident.id)).toMatchObject({
      solution: 'Corregir la configuración',
      resolvedDate: '2026-09-14',
    });
  });

  it('rechaza soluciones sin fecha y resoluciones anteriores a la incidencia', () => {
    const base = { ...blank('incident'), title: 'Fallo', date: '2026-09-12' };
    expect(() => d.save('incident', { ...base, solution: 'Corregido' })).toThrow();
    expect(() => d.save('incident', { ...base, resolvedDate: '2026-09-14' })).toThrow();
    expect(() =>
      d.save('incident', { ...base, solution: 'Corregido', resolvedDate: '2026-09-11' }),
    ).toThrow();
  });

  it('clasifica correctamente si una incidencia está solucionada', () => {
    const pending: Incident = {
      ...blank('incident'),
      kind: 'incident',
      id: 'i1',
      version: 1,
      createdAt: '2026-09-12T10:00:00Z',
      updatedAt: '2026-09-12T10:00:00Z',
      title: 'Fallo de red',
      project: '',
      date: '2026-09-12',
      description: 'Sin conexión',
      solution: '',
      resolvedDate: '',
    };
    expect(isIncidentResolved(pending)).toBe(false);

    const withSolutionOnly: Incident = {
      ...pending,
      solution: 'Revisar router',
    };
    expect(isIncidentResolved(withSolutionOnly)).toBe(false);

    const resolved: Incident = {
      ...pending,
      solution: 'Router reiniciado',
      resolvedDate: '2026-09-13',
    };
    expect(isIncidentResolved(resolved)).toBe(true);
  });
});

describe('decisiones e ideas del día', () => {
  it('guarda su fecha y valida días reales', async () => {
    const decision = d.save('decision', {
      ...blank('decision'),
      title: 'Elegir almacenamiento',
      date: '2026-09-12',
      decision: 'Usar almacenamiento local',
    });
    const idea = d.save('idea', {
      ...blank('idea'),
      title: 'Mejorar búsquedas',
      date: '2026-09-13',
      description: 'Probar filtros por fecha',
    });
    expect(() =>
      d.save('decision', { ...blank('decision'), title: 'Sin día', date: '' }),
    ).toThrow();
    expect(() =>
      d.save('idea', { ...blank('idea'), title: 'Día imposible', date: '2026-02-30' }),
    ).toThrow();
    d.lock();
    await d.unlock(pass);
    expect(d.require().records.find((record) => record.id === decision.id)).toMatchObject({
      date: '2026-09-12',
    });
    expect(d.require().records.find((record) => record.id === idea.id)).toMatchObject({
      date: '2026-09-13',
      description: 'Probar filtros por fecha',
    });
  });

  it('asigna fecha a decisiones antiguas al abrir y al restaurar', async () => {
    const decision = d.save('decision', { ...blank('decision'), title: 'Decisión anterior' });
    const state = d.require();
    delete (state.records.find((record) => record.id === decision.id) as Partial<Decision>).date;
    const history = state.history.find((entry) => entry.recordId === decision.id)!;
    if (history.after.kind === 'decision') delete (history.after as Partial<Decision>).date;
    d.vault.save(state);
    const backup = d.vault.backup('contraseña separada de copia');
    d.lock();
    await d.unlock(pass);
    expect(d.require().records.find((record) => record.id === decision.id)).toMatchObject({
      date: decision.createdAt.slice(0, 10),
    });
    const restored = await d.vault.restore(backup, 'contraseña separada de copia');
    expect(restored.records.find((record) => record.id === decision.id)).toMatchObject({
      date: decision.createdAt.slice(0, 10),
    });
  });
});

describe('vínculos de entradas', () => {
  it('guarda referencias a los cuatro tipos y rechaza vínculos inválidos', () => {
    const linkedTask = task();
    const incident = d.save('incident', { ...blank('incident'), title: 'Fallo de acceso' });
    const decision = d.save('decision', { ...blank('decision'), title: 'Elegir acceso local' });
    const idea = d.save('idea', { ...blank('idea'), title: 'Mejorar el acceso' });
    const entry = d.save('entry', {
      ...blank('entry'),
      title: 'Jornada',
      taskIds: [linkedTask.id],
      linkedIds: [incident.id, decision.id, idea.id],
      activity: `Investigué @[incident:${incident.id}] y decidí @[decision:${decision.id}]`,
    }) as Entry;
    expect(entry.linkedIds).toEqual([incident.id, decision.id, idea.id]);
    expect(entry.activity).toContain(`@[incident:${incident.id}]`);
    expect(memoryReport(d.require().records)).toContain('@Fallo de acceso');
    expect(memoryReport(d.require().records)).not.toContain(`@[incident:${incident.id}]`);
    expect(() =>
      d.save('entry', { ...entry, linkedIds: [incident.id, incident.id] }, entry.id, entry.version),
    ).toThrow('No repitas');
    expect(() =>
      d.save('entry', { ...entry, linkedIds: ['desconocido'] }, entry.id, entry.version),
    ).toThrow('ya no existe');
    d.deleteIncident(incident.id, incident.version);
    const current = d.require().records.find((record) => record.id === entry.id) as Entry;
    expect(current.linkedIds).toEqual([decision.id, idea.id]);
    expect(current.activity).toContain(`@[incident:${incident.id}]`);
    expect(memoryReport(d.require().records)).toContain('@Registro eliminado');
  });
  it('reserva los vínculos explícitos para edición humana', () => {
    const entry = d.save('entry', { ...blank('entry'), title: 'Jornada' });
    const { auth } = grant(entry.id);
    expect(() =>
      d.propose(auth, {
        operation: 'update',
        kind: 'entry',
        targetId: entry.id,
        expectedVersion: entry.version,
        patch: { linkedIds: [] },
        rationale: 'Añadir referencias',
      }),
    ).toThrow('reservados');
  });
  it('recupera entradas anteriores sin el nuevo campo de vínculos', async () => {
    const entry = d.save('entry', { ...blank('entry'), title: 'Jornada anterior' });
    const state = structuredClone(d.require());
    delete (state.records.find((record) => record.id === entry.id) as Partial<Entry>).linkedIds;
    d.vault.save(state);
    d.lock();
    await d.unlock(pass);
    const restored = d.require().records.find((record) => record.id === entry.id) as Entry;
    expect(restored.linkedIds).toBeUndefined();
    const updated = d.save(
      'entry',
      { ...restored, result: 'Continuación' },
      restored.id,
      restored.version,
    ) as Entry;
    expect(updated.linkedIds).toEqual([]);
  });
});

describe('criterios y estados', () => {
  it('asocia criterios por fase y etiqueta sin IA', () => {
    const p = practice({ phases: ['Diseño'], tags: ['acceso'] });
    expect(task().checks.some((c) => c.practiceId === p.id)).toBe(false);
    expect(
      task({ phase: 'Diseño', tags: ['acceso'] }).checks.some((c) => c.practiceId === p.id),
    ).toBe(true);
  });
  it('asocia automáticamente solo prácticas vigentes a tareas creadas por MCP', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto criterios' });
    const active = practice({ project: project.id, status: 'Recomendación personal' });
    const draft = practice({ project: project.id, status: 'Borrador' });
    const retired = practice({ project: project.id, status: 'Retirada' });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const auth = d.authorize(d.grant('codex', [], 'projects', [project.id]).token);
    const proposal = d.propose(auth, {
      operation: 'create',
      kind: 'task',
      patch: {
        project: project.id,
        title: 'Verificar entrega',
        phase: 'Implementación',
        priority: 'Media',
        due: madridDate(),
        nextStep: 'Revisar el entregable.',
        description:
          'Objetivo: verificar la entrega. Criterios de aceptación: revisión documentada.',
      },
      rationale: 'Crear tarea de verificación.',
    });
    d.review(proposal.id, true);
    const created = d
      .require()
      .records.find((r) => r.kind === 'task' && r.title === 'Verificar entrega') as Task;
    expect(created.checks.map((c) => c.practiceId)).toEqual([active.id]);
    expect(
      created.checks.some((c) => c.practiceId === draft.id || c.practiceId === retired.id),
    ).toBe(false);
  });
  it('excluye prácticas en borrador de la asociación automática a tareas hasta su maduración', () => {
    const draft = practice({ title: 'Criterio en maduración', status: 'Borrador' });
    const t = task();
    expect(t.checks.some((c) => c.practiceId === draft.id)).toBe(false);

    // Tampoco se añade con syncCriteria mientras siga en borrador
    const syncedWhileDraft = d.syncCriteria(t.id, t.version);
    expect(syncedWhileDraft.checks.some((c) => c.practiceId === draft.id)).toBe(false);

    // Al madurar y promoverse a recomendación personal, se asocia
    const promoted = d.save(
      'practice',
      { ...draft, status: 'Recomendación personal' },
      draft.id,
      draft.version,
    ) as Practice;
    const newTask = task({ title: 'Nueva tarea tras maduración' });
    expect(newTask.checks.some((c) => c.practiceId === promoted.id)).toBe(true);

    const syncedAfterPromotion = d.syncCriteria(t.id, syncedWhileDraft.version);
    expect(syncedAfterPromotion.checks.some((c) => c.practiceId === promoted.id)).toBe(true);
  });
  it('permite persistir y recuperar borradores de criterios y verificaciones de tareas', () => {
    const pDraftKey = 'new:practice';
    d.saveDraft(pDraftKey, { title: 'Borrador preliminar', category: 'Calidad técnica' });
    expect(d.require().drafts?.[pDraftKey]).toMatchObject({
      title: 'Borrador preliminar',
      category: 'Calidad técnica',
    });

    const t = task();
    const tDraftKey = `record:${t.id}`;
    const draftChecks = [
      ...t.checks,
      {
        practiceId: 'dummy-id',
        practiceVersion: 1,
        title: 'Verificación preliminar',
        explanation: '',
        source: '',
        mandatory: false,
        state: 'Pendiente',
        note: 'Recopilando evidencias preliminares',
        authorization: '',
        exceptionReason: '',
      },
    ];
    d.saveDraft(tDraftKey, { ...t, checks: draftChecks });
    expect(d.require().drafts?.[tDraftKey]?.checks).toHaveLength(draftChecks.length);
    // El registro permanente no se ve alterado
    expect((d.require().records.find((r) => r.id === t.id) as Task).checks).toHaveLength(
      t.checks.length,
    );

    // Limpieza de borrador
    d.deleteDraft(tDraftKey);
    expect(d.require().drafts?.[tDraftKey]).toBeUndefined();
  });
  it('no permite completar requisitos pendientes ni eliminarlos desde el cliente', () => {
    const p = practice({ mandatory: true });
    const t = task();
    expect(() =>
      d.save('task', { ...t, state: 'Completada', checks: [] }, t.id, t.version),
    ).toThrow('obligatorios');
    expect(d.require().records.find((r) => r.id === t.id)?.version).toBe(t.version);
  });
  it('permite un motivo opcional para no aplicable y mantiene pendiente el incumplimiento', () => {
    practice({ mandatory: true });
    const t = task();
    const noApplicable = d.save(
      'task',
      {
        ...t,
        checks: t.checks.map((c) => ({ ...c, state: 'No aplicable' })),
      },
      t.id,
      t.version,
    ) as Task;
    expect(noApplicable.checks.every((c) => c.state === 'No aplicable')).toBe(true);
    const unmet = d.save(
      'task',
      {
        ...noApplicable,
        checks: noApplicable.checks.map((c) => ({
          ...c,
          state: 'No cumplido',
          note: 'Pendiente de resolver',
        })),
      },
      t.id,
      noApplicable.version,
    ) as Task;
    expect(unmet.checks.every((c) => c.state === 'No cumplido')).toBe(true);
    expect(() => d.save('task', { ...unmet, state: 'Completada' }, t.id, unmet.version)).toThrow(
      'obligatorios',
    );
  });
  it('requiere motivo y referencia para una excepción', () => {
    const p = practice({ mandatory: true });
    const t = task();
    expect(() =>
      d.save(
        'task',
        {
          ...t,
          checks: t.checks.map((c) =>
            c.practiceId === p.id ? { ...c, exceptionReason: 'Aprobado' } : c,
          ),
        },
        t.id,
        t.version,
      ),
    ).toThrow('autorización');
    const saved = d.save(
      'task',
      {
        ...t,
        state: 'Completada',
        checks: t.checks.map((c) => ({
          ...c,
          exceptionReason: 'Caso autorizado',
          authorization: 'ACTA-2',
        })),
      },
      t.id,
      t.version,
    ) as Task;
    expect(saved.state).toBe('Completada');
  });
  it('no acepta cambios en autoridad del snapshot del criterio', () => {
    const p = practice({ mandatory: true });
    const t = task();
    expect(() =>
      d.save(
        'task',
        { ...t, state: 'Completada', checks: t.checks.map((c) => ({ ...c, mandatory: false })) },
        t.id,
        t.version,
      ),
    ).toThrow('obligatorios');
  });
  it('rechaza asociar manualmente criterios de otro proyecto', () => {
    const otherProject = d.save('project', { ...blank('project'), title: 'Otro proyecto' });
    const external = practice({ project: otherProject.id });
    const t = task();
    expect(() =>
      d.save('task', { ...t, checks: [...t.checks, snapshotCheck(external)] }, t.id, t.version),
    ).toThrow('otro proyecto');
  });
  it('mantiene snapshots históricos y exige revisar actualizaciones', () => {
    const p = practice();
    const t = task();
    d.save('practice', { ...p, title: 'Nueva política' }, p.id, p.version);
    expect(
      (d.require().records.find((r) => r.id === t.id) as Task).checks.find(
        (c) => c.practiceId === p.id,
      )?.title,
    ).toBe(p.title);
    expect(() => d.save('task', { ...t, state: 'Completada' }, t.id, t.version)).toThrow(
      'versiones',
    );
    const synced = d.syncCriteria(t.id, t.version);
    expect(synced.checks.find((c) => c.practiceId === p.id)?.title).toBe('Nueva política');
    expect(synced.checks.find((c) => c.practiceId === p.id)?.state).toBe('Pendiente');
  });
  it('preserva versiones de tareas terminadas al actualizar políticas', () => {
    const p = practice();
    let t = task();
    t = d.save('task', { ...t, state: 'Completada' }, t.id, t.version) as Task;
    d.save('practice', { ...p, title: 'Nueva política' }, p.id, p.version);
    expect(() => d.syncCriteria(t.id, t.version)).toThrow();
    expect(
      (d.require().records.find((r) => r.id === t.id) as Task).checks.find(
        (c) => c.practiceId === p.id,
      )?.practiceVersion,
    ).toBe(1);
  });
  it('una política confirmada necesita referencia y la validación necesita tutor', () => {
    expect(() => practice({ status: 'Política de empresa confirmada' })).toThrow('fuente');
    expect(() =>
      d.save('project', { ...blank('project'), title: 'Proyecto', validationDate: '2026-09-23' }),
    ).toThrow('tutor');
  });
  it('registra cambios de varios días y permite deshacer con control de versión', () => {
    const t = task();
    const changed = d.save('task', { ...t, state: 'En curso' }, t.id, t.version);
    const history = d.require().history[0];
    expect(() => d.save('task', { ...t, title: 'Conflicto' }, t.id, t.version)).toThrow(
      'Conflicto',
    );
    const undone = d.undo(history.id) as Task;
    expect(undone.state).toBe('Por hacer');
    expect(undone.version).toBe(changed.version + 1);
    expect(d.require().history.length).toBe(3);
  });
});
describe('frontera MCP', () => {
  it('borra un proyecto y conserva sus registros como transversales', async () => {
    const project = d.save('project', { ...blank('project'), title: 'Temporal' });
    const linked = task({ project: project.id });
    const unrelated = task();
    const { g } = grant(project.id);
    d.saveDraft(`record:${project.id}`, { title: 'Edición' });
    d.saveDraft(`record:${linked.id}`, { project: project.id, title: 'Pendiente' });
    d.saveDraft(`daily:2026-09-24:${project.id}`, { project: project.id, activity: 'Avance' });
    expect(() => d.deleteProject(project.id, project.version - 1)).toThrow('Conflicto');
    expect(() => d.deleteProject(linked.id, linked.version)).toThrow('no encontrado');
    d.deleteProject(project.id, project.version);
    expect(d.require().records.some((record) => record.id === project.id)).toBe(false);
    expect(d.require().records.find((record) => record.id === linked.id)).toMatchObject({
      project: '',
      version: linked.version + 1,
    });
    expect(d.require().records.find((record) => record.id === unrelated.id)).toEqual(unrelated);
    expect(d.require().drafts?.[`record:${project.id}`]).toBeUndefined();
    expect(d.require().drafts?.[`record:${linked.id}`]?.project).toBe('');
    expect(d.require().drafts?.[`daily:2026-09-24:none`]?.activity).toBe('Avance');
    expect(d.require().history.some((entry) => entry.recordId === project.id)).toBe(false);
    expect(() => d.authorize(g.token)).toThrow();
    d.lock();
    await d.unlock(pass);
    expect(d.require().records.find((record) => record.id === linked.id)?.project).toBe('');
  });
  it.each([
    ['entry', 'deleteEntry', 'Entrada'],
    ['decision', 'deleteDecision', 'Decisión'],
    ['idea', 'deleteIdea', 'Idea'],
  ] as const)('borrar %s limpia referencias, borradores y permisos', (kind, method, label) => {
    const record = d.save(kind, { ...blank(kind), title: `${label} de prueba` }) as
      Entry | Decision | Idea;
    const linked = d.save('entry', {
      ...blank('entry'),
      title: 'Entrada vinculada',
      linkedIds: kind === 'entry' ? [] : [record.id],
    }) as Entry;
    const meeting = d.save('meeting', {
      ...blank('meeting'),
      title: 'Reunión vinculada',
      sourceIds: [record.id],
    });
    const { g } = grant(record.id);
    d.saveDraft(`record:${record.id}`, { title: 'Cambios pendientes' });
    const remove = d[method].bind(d);
    expect(() => remove(record.id, record.version - 1)).toThrow('Conflicto');
    const wrongKind = kind === 'entry' ? task() : linked;
    expect(() => remove(wrongKind.id, wrongKind.version)).toThrow('no encontrada');
    remove(record.id, record.version);
    expect(d.require().records.some((item) => item.id === record.id)).toBe(false);
    expect((d.require().records.find((item) => item.id === linked.id) as Entry).linkedIds).toEqual(
      [],
    );
    expect(d.require().records.find((item) => item.id === meeting.id)).toMatchObject({
      sourceIds: [],
    });
    expect(d.require().drafts?.[`record:${record.id}`]).toBeUndefined();
    expect(d.require().history.some((item) => item.recordId === record.id)).toBe(false);
    expect(() => d.authorize(g.token)).toThrow();
  });
  it('borrar una reunión exige su versión y retira sus datos asociados', () => {
    const meeting = d.save('meeting', { ...blank('meeting'), title: 'Reunión temporal' });
    const { g } = grant(meeting.id);
    d.saveDraft(`record:${meeting.id}`, { title: 'Cambios pendientes' });
    expect(() => d.deleteMeeting(meeting.id, meeting.version - 1)).toThrow('Conflicto');
    expect(() => d.deleteMeeting(task().id, meeting.version)).toThrow('no encontrada');
    d.deleteMeeting(meeting.id, meeting.version);
    expect(d.require().records.some((record) => record.id === meeting.id)).toBe(false);
    expect(d.require().drafts?.[`record:${meeting.id}`]).toBeUndefined();
    expect(d.require().history.some((item) => item.recordId === meeting.id)).toBe(false);
    expect(() => d.authorize(g.token)).toThrow();
  });
  it('borrar una incidencia elimina sus referencias y revoca extractos', async () => {
    const incident = d.save('incident', {
      ...blank('incident'),
      title: 'Incidencia de prueba',
    }) as Incident;
    const other = task();
    const meeting = d.save('meeting', {
      ...blank('meeting'),
      title: 'Reunión de prueba',
      sourceIds: [incident.id, other.id],
    });
    const { g } = grant(incident.id);
    expect(() => d.deleteIncident(incident.id, incident.version - 1)).toThrow('Conflicto');
    expect(() => d.deleteIncident(other.id, other.version)).toThrow('Incidencia no encontrada');
    expect(d.require().records.some((record) => record.id === incident.id)).toBe(true);
    d.deleteIncident(incident.id, incident.version);
    expect(d.require().records.some((record) => record.id === incident.id)).toBe(false);
    const savedMeeting = d.require().records.find((record) => record.id === meeting.id);
    expect(savedMeeting?.kind === 'meeting' ? savedMeeting.sourceIds : undefined).toEqual([
      other.id,
    ]);
    expect(d.require().history.some((entry) => entry.recordId === incident.id)).toBe(false);
    expect(d.require().shares.some((share) => share.recordId === incident.id)).toBe(false);
    expect(() => d.authorize(g.token)).toThrow();
    d.lock();
    await d.unlock(pass);
    expect(d.require().records.some((record) => record.id === incident.id)).toBe(false);
  });
  it('borrar una tarea limpia vínculos y revoca extractos sin afectar otros registros', () => {
    const t = task();
    const other = task({ title: 'Otra tarea' });
    const entry = d.save('entry', {
      ...blank('entry'),
      title: 'Jornada',
      taskIds: [t.id, other.id],
    }) as Entry;
    const { g } = grant(t.id);
    expect(() => d.deleteTask(t.id, t.version - 1)).toThrow('Conflicto');
    expect(() => d.deleteTask(other.id, t.version - 1)).toThrow('Conflicto');
    d.deleteTask(t.id, t.version);
    expect(d.require().records.some((record) => record.id === t.id)).toBe(false);
    expect((d.require().records.find((record) => record.id === entry.id) as Entry).taskIds).toEqual(
      [other.id],
    );
    expect(d.require().shares.some((share) => share.recordId === t.id)).toBe(false);
    expect(d.require().history.some((item) => item.recordId === t.id)).toBe(false);
    expect(() => d.authorize(g.token)).toThrow();
  });
  it.each(['claude', 'codex', 'antigravity'] as Provider[])(
    '%s solo recibe extractos autorizados, incluidos títulos',
    (provider) => {
      const t = task({ title: 'CLIENTE SECRETO', description: 'password: secreto-interno' });
      const p = practice({ title: 'POLITICA INTERNA' });
      const { auth } = grant(t.id, provider);
      const result = JSON.stringify(d.context(auth, {}));
      expect(result).toContain('Título revisado');
      expect(result).not.toContain('CLIENTE SECRETO');
      expect(result).not.toContain('password');
      expect(result).not.toContain('POLITICA INTERNA');
      expect(d.context(auth, { query: 'CLIENTE SECRETO' }).items).toEqual([]);
    },
  );
  it('separa proveedores y requiere autorización de empresa', () => {
    const t = task();
    expect(() => d.share({ recordId: t.id, provider: 'claude', title: 'T', excerpt: 'E' })).toThrow(
      'empresa',
    );
    const { sh } = grant(t.id);
    expect(() => d.grant('codex', [sh.id])).toThrow('proveedor');
  });
  it.each(['claude', 'codex', 'antigravity'] as Provider[])(
    '%s solo consulta los proyectos marcados y sus registros',
    (provider) => {
      const selected = d.save('project', { ...blank('project'), title: 'Proyecto elegido' });
      const hidden = d.save('project', { ...blank('project'), title: 'Proyecto oculto' });
      const t = task({
        project: selected.id,
        title: 'Tarea visible',
        description: 'Detalle visible',
      });
      const privateTask = task({ project: hidden.id, title: 'Tarea oculta' });
      const incident = d.save('incident', {
        ...blank('incident'),
        project: selected.id,
        title: 'Incidencia visible',
      });
      d.save('idea', { ...blank('idea'), project: selected.id, title: 'Idea visible' });
      d.save('decision', { ...blank('decision'), project: selected.id, title: 'Decisión visible' });
      const entry = d.save('entry', {
        ...blank('entry'),
        project: selected.id,
        title: 'Entrada visible',
        taskIds: [privateTask.id],
      });
      d.settings({ companyAuthorized: true, universityStructure: '' });
      expect(() => d.grant(provider, [], 'projects', [hidden.id, hidden.id])).toThrow();
      expect(() => d.grant(provider, [], 'projects', ['inexistente'])).toThrow();
      const g = d.grant(provider, [], 'projects', [selected.id]);
      const auth = d.authorize(g.token);
      const search = JSON.stringify(d.context(auth, { limit: 10 }, true));
      expect(search).toContain('Proyecto elegido');
      expect(search).toContain('Incidencia visible');
      expect(search).not.toContain('Proyecto oculto');
      expect(search).not.toContain('Tarea oculta');
      const read = JSON.stringify(
        d.context(auth, { recordIds: [t.id, privateTask.id, entry.id, incident.id] }),
      );
      expect(read).toContain('Detalle visible');
      expect(read).not.toContain(privateTask.id);
      expect(read).not.toContain('Tarea oculta');
      expect(() =>
        d.propose(auth, {
          operation: 'update',
          kind: 'task',
          targetId: privateTask.id,
          expectedVersion: privateTask.version,
          patch: { title: 'Cambio' },
          rationale: '',
        }),
      ).toThrow('proyecto');
      expect(() =>
        d.propose(auth, {
          operation: 'create',
          kind: 'task',
          patch: { title: 'Sin proyecto' },
          rationale: '',
        }),
      ).toThrow('proyecto');
      const proposal = d.propose(auth, {
        operation: 'create',
        kind: 'task',
        patch: {
          title: 'Nueva tarea',
          project: selected.id,
          phase: 'Implementación',
          priority: 'Media',
          due: madridDate(),
          description: 'Objetivo y criterios de aceptación.',
          nextStep: 'Revisar el alcance.',
        },
        rationale: '',
      });
      for (const kind of ['incident', 'idea'] as const) {
        const created = d.propose(auth, {
          operation: 'create',
          kind,
          patch: {
            title: `Nueva ${kind}`,
            project: selected.id,
            date: madridDate(),
            description: 'Descripción del registro.',
          },
          rationale: '',
        });
        expect(d.proposalStatus(auth).items).toContainEqual(
          expect.objectContaining({ id: created.id }),
        );
      }
      expect(d.proposalStatus(auth).items).toContainEqual(
        expect.objectContaining({ id: proposal.id }),
      );
      d.updateGrantProjects(g.id, [hidden.id]);
      expect(d.context(auth, { query: 'Proyecto elegido' }).items).toEqual([]);
      expect(d.proposalStatus(auth).items).not.toContainEqual(
        expect.objectContaining({ id: proposal.id }),
      );
      d.revokeGrant(g.id);
      expect(() => d.authorize(g.token)).toThrow();
    },
  );
  it('revocar, bloquear y caducar elimina acceso', () => {
    const t = task();
    let { g } = grant(t.id);
    d.revokeGrant(g.id);
    expect(() => d.authorize(g.token)).toThrow();
    g = grant(t.id).g;
    d.grants.get(g.id)!.expiresAt = new Date(0).toISOString();
    expect(() => d.authorize(g.token)).toThrow();
    g = grant(t.id).g;
    d.lock();
    expect(() => d.authorize(g.token)).toThrow('bloqueada');
  });
  it('un extracto desactualizado deja de leerse', () => {
    const t = task();
    const { auth } = grant(t.id);
    d.save('task', { ...t, description: 'Cambio interno' }, t.id, t.version);
    expect(d.context(auth, {}).items).toEqual([]);
  });
  it('revocar extractos revoca las sesiones que los usan', () => {
    const t = task();
    const { g, sh } = grant(t.id);
    d.revokeShare(sh.id);
    expect(() => d.authorize(g.token)).toThrow();
  });
  it('la IA propone pero no modifica hasta aceptar; detecta conflictos', () => {
    const t = task();
    const { auth } = grant(t.id);
    const p = d.propose(auth, {
      operation: 'update',
      kind: 'task',
      targetId: t.id,
      expectedVersion: t.version,
      patch: { title: 'Nuevo título' },
      rationale: 'Aclarar',
    });
    expect(d.require().records.find((r) => r.id === t.id)?.title).toBe(t.title);
    d.review(p.id, true);
    expect(d.require().records.find((r) => r.id === t.id)?.title).toBe('Nuevo título');
    const refreshed = d.require().records.find((r) => r.id === t.id)!;
    const { auth: auth2 } = grant(t.id);
    const p2 = d.propose(auth2, {
      operation: 'update',
      kind: 'task',
      targetId: t.id,
      expectedVersion: refreshed.version,
      patch: { title: 'Obsoleto' },
      rationale: 'Cambio',
    });
    d.save('task', { ...refreshed, title: 'Cambio humano' }, t.id, refreshed.version);
    expect(() => d.review(p2.id, true)).toThrow('Conflicto');
  });
  it('vincula menciones autorizadas al aceptar una entrada MCP', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto visible' });
    const otherProject = d.save('project', { ...blank('project'), title: 'Proyecto ajeno' });
    const mentionedTask = task({ project: project.id, title: 'Revisar arquitectura' });
    const incident = d.save('incident', {
      ...blank('incident'),
      project: project.id,
      title: 'Fallo de inicio',
    });
    const idea = d.save('idea', {
      ...blank('idea'),
      project: project.id,
      title: 'Mejora futura',
    });
    const decision = d.save('decision', {
      ...blank('decision'),
      project: project.id,
      title: 'Elegir estructura',
    });
    const otherTask = task({ project: otherProject.id, title: 'Tarea ajena' });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const grant = d.grant('codex', [], 'projects', [project.id]);
    const auth = d.authorize(grant.token);

    expect(() =>
      d.propose(auth, {
        operation: 'create',
        kind: 'entry',
        patch: { project: project.id, title: 'Entrada', taskIds: [mentionedTask.id] },
        rationale: '',
      }),
    ).toThrow('reservados');

    const proposal = d.propose(auth, {
      operation: 'create',
      kind: 'entry',
      patch: {
        project: project.id,
        title: 'Entrada con menciones',
        activity: `Avancé con @Revisar arquitectura y @Fallo de inicio. Ignoré @[task:${otherTask.id}].`,
        result: `Seguí @Elegir estructura, @Mejora futura y @[task:${mentionedTask.id}].`,
        nextStep: '@Revisar arquitectura',
      },
      rationale: '',
    });
    expect(d.require().records.some((record) => record.title === 'Entrada con menciones')).toBe(
      false,
    );
    d.review(proposal.id, true);
    const entry = d
      .require()
      .records.find((record) => record.title === 'Entrada con menciones') as Entry;
    expect(entry.taskIds).toEqual([mentionedTask.id]);
    expect(entry.linkedIds).toEqual([incident.id, decision.id, idea.id]);
    expect(entry.activity).toContain(`@[task:${mentionedTask.id}]`);
    expect(entry.activity).toContain(`@[incident:${incident.id}]`);
    expect(entry.result).toContain(`@[decision:${decision.id}]`);
    expect(entry.result).toContain(`@[idea:${idea.id}]`);
    expect(entry.taskIds).not.toContain(otherTask.id);
  });
  it('no vincula menciones fuera del extracto autorizado y conserva vínculos previos', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto' });
    const allowed = task({ project: project.id, title: 'Tarea compartida' });
    const privateTask = task({ project: project.id, title: 'Tarea privada' });
    const entry = d.save('entry', {
      ...blank('entry'),
      project: project.id,
      title: 'Entrada existente',
      taskIds: [allowed.id],
      linkedIds: undefined,
    }) as Entry;
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const sharedTask = d.share({
      recordId: allowed.id,
      provider: 'codex',
      title: 'Tarea compartida',
      excerpt: 'Resumen autorizado',
    });
    const sharedEntry = d.share({
      recordId: entry.id,
      provider: 'codex',
      title: 'Entrada existente',
      excerpt: 'Resumen autorizado',
    });
    const grant = d.grant('codex', [sharedTask.id, sharedEntry.id]);
    const auth = d.authorize(grant.token);
    const proposal = d.propose(auth, {
      operation: 'update',
      kind: 'entry',
      targetId: entry.id,
      expectedVersion: entry.version,
      patch: {
        result: `Se trabajó en @Tarea compartida y @Tarea privada. Referencia @[task:${privateTask.id}].`,
      },
      rationale: '',
    });
    d.review(proposal.id, true);
    const updated = d.require().records.find((record) => record.id === entry.id) as Entry;
    expect(updated.taskIds).toEqual([allowed.id]);
    expect(updated.linkedIds).toEqual([]);
    expect(updated.result).toContain(`@[task:${allowed.id}]`);
    expect(updated.result).toContain('@Tarea privada');
  });
  it('un ID autorizado permite proponer el cierre con resumen revisable', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto visible' });
    const t = task({ project: project.id, description: 'Contexto inicial' });
    const privateTask = task({ description: 'Fuera del proyecto' });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const g = d.grant('codex', [], 'projects', [project.id]);
    const auth = d.authorize(g.token);

    expect(d.context(auth, { recordIds: [t.id] }).items).toMatchObject([
      { id: t.id, version: t.version, kind: 'task' },
    ]);
    expect(d.context(auth, { recordIds: [privateTask.id] }).items).toEqual([]);

    const proposal = d.propose(auth, {
      operation: 'update',
      kind: 'task',
      targetId: t.id,
      expectedVersion: t.version,
      patch: { state: 'Completada', solution: 'Se verificó el resultado.' },
      rationale: 'Trabajo terminado',
    });
    expect(d.require().records.find((record) => record.id === t.id)).toMatchObject({
      state: 'En revisión',
      description: 'Contexto inicial',
    });
    expect(d.require().proposals.find((item) => item.id === proposal.id)?.expectedVersion).toBe(
      t.version + 1,
    );
    expect(() =>
      d.propose(auth, {
        operation: 'update',
        kind: 'task',
        targetId: t.id,
        expectedVersion: t.version + 1,
        patch: { state: 'Completada', solution: 'Otro cierre.' },
        rationale: 'Duplicado',
      }),
    ).toThrow('propuesta de cierre pendiente');
    expect(d.proposalStatus(auth).items).toContainEqual(
      expect.objectContaining({ id: proposal.id }),
    );
    d.review(proposal.id, true);
    expect(d.require().records.find((record) => record.id === t.id)).toMatchObject({
      state: 'Completada',
      description: 'Contexto inicial',
      solution: 'Se verificó el resultado.',
    });
  });
  it('rechazar un cierre devuelve el estado previo si la tarea no cambió', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto' });
    const t = task({ project: project.id, state: 'En curso' });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const g = d.grant('codex', [], 'projects', [project.id]);
    const auth = d.authorize(g.token);
    const proposal = d.propose(auth, {
      operation: 'update',
      kind: 'task',
      targetId: t.id,
      expectedVersion: t.version,
      patch: { state: 'Completada', solution: 'Resultado verificado.' },
      rationale: 'Trabajo terminado',
    });
    expect((d.require().records.find((record) => record.id === t.id) as Task).state).toBe(
      'En revisión',
    );
    d.review(proposal.id, false);
    expect((d.require().records.find((record) => record.id === t.id) as Task).state).toBe(
      'En curso',
    );
  });
  it('permite consultar el estado del cierre con un extracto individual ya desactualizado', () => {
    const t = task();
    const { auth } = grant(t.id);
    const proposal = d.propose(auth, {
      operation: 'update',
      kind: 'task',
      targetId: t.id,
      expectedVersion: t.version,
      patch: { state: 'Completada', solution: 'Resultado verificado.' },
      rationale: 'Trabajo terminado',
    });
    expect(d.context(auth, { recordIds: [t.id] }).items).toEqual([]);
    expect(d.proposalStatus(auth).items).toContainEqual(
      expect.objectContaining({ id: proposal.id }),
    );
  });
  it('la IA puede proponer actualizar especificaciones u objetivos de un proyecto autorizado', () => {
    const project = d.save('project', {
      ...blank('project'),
      title: 'Bitácora Core',
      objective: 'Organizador local',
      specifications: 'Versión inicial',
    });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const g = d.grant('codex', [], 'projects', [project.id]);
    const auth = d.authorize(g.token);

    const read = d.context(auth, { recordIds: [project.id] });
    expect(read.items[0]).toMatchObject({
      id: project.id,
      kind: 'project',
      version: project.version,
      title: 'Bitácora Core',
    });
    expect(JSON.parse(d.visible(auth).find((sh) => sh.recordId === project.id)!.excerpt)).toEqual({
      objective: 'Organizador local',
      specifications: 'Versión inicial',
      competency: '',
    });

    const proposal = d.propose(auth, {
      operation: 'update',
      kind: 'project',
      targetId: project.id,
      expectedVersion: project.version,
      patch: {
        specifications: 'Arquitectura offline-first modular con Zod y Vault.',
      },
      rationale: 'Revisión técnica del repositorio sin secretos.',
    });

    expect(d.proposalStatus(auth).items).toContainEqual(
      expect.objectContaining({ id: proposal.id }),
    );
    expect((d.require().records.find((r) => r.id === project.id) as Project)?.specifications).toBe(
      'Versión inicial',
    );

    d.review(proposal.id, true);
    expect(d.require().records.find((r) => r.id === project.id)).toMatchObject({
      specifications: 'Arquitectura offline-first modular con Zod y Vault.',
      version: project.version + 1,
    });

    expect(() =>
      d.propose(auth, {
        operation: 'update',
        kind: 'project',
        targetId: project.id,
        expectedVersion: project.version + 1,
        patch: { tutor: 'Falso Tutor' },
        rationale: '',
      }),
    ).toThrow('reservados');
  });
  it('la IA no puede confirmar políticas ni autorizar excepciones ni validar tutores', () => {
    const p = practice();
    const { auth } = grant(p.id);
    expect(() =>
      d.propose(auth, {
        operation: 'update',
        kind: 'practice',
        targetId: p.id,
        expectedVersion: p.version,
        patch: { status: 'Política de empresa confirmada' },
        rationale: '',
      }),
    ).toThrow('autoridad');
    expect(() =>
      d.propose(auth, {
        operation: 'create',
        kind: 'project',
        patch: { title: 'Falso' },
        rationale: '',
      }),
    ).toThrow('humana');
    expect(() =>
      d.propose(auth, {
        operation: 'create',
        kind: 'task',
        patch: { title: 'Tarea', checks: [] },
        rationale: '',
      }),
    ).toThrow('reservados');
    expect(() =>
      d.propose(auth, {
        operation: 'create',
        kind: 'entry',
        patch: { title: 'Entrada', dependencyIds: [] },
        rationale: '',
      }),
    ).toThrow('reservados');
  });
  it('conserva especificaciones breves y amplias en propuestas MCP sin aplicarlas antes de revisión', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto de prueba' });
    const previous = task({ project: project.id, title: 'Definir formato CSV' });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const { token } = d.grant('codex', [], 'projects', [project.id]);
    const auth = d.authorize(token);
    const examples = [
      {
        title: 'Normalizar espacios en títulos',
        description:
          'Objetivo: eliminar espacios exteriores al editar un título. Contexto: conservar la validación de longitud. Criterios de aceptación: 1. "  Informe  " se guarda como "Informe". 2. Un título demasiado largo sigue rechazado. Verificación: pruebas de edición y validación.',
        dependencyIds: [] as string[],
      },
      {
        title: 'Exportar tareas visibles a CSV',
        description:
          'Objetivo: exportar tareas del proyecto autorizado. Contexto: conservar permisos y respuesta JSON. Criterios de aceptación: 1. Solo aparecen tareas visibles, comprobado en prueba de autorización. 2. El CSV escapa campos, comprobado en prueba de serialización. 3. La respuesta JSON no cambia, comprobado en prueba de regresión. Plan: autorización, serialización e interfaz en ese orden.',
        dependencyIds: [previous.id],
      },
    ];

    for (const example of examples) {
      const proposal = d.propose(auth, {
        operation: 'create',
        kind: 'task',
        patch: {
          project: project.id,
          title: example.title,
          phase: 'Implementación',
          priority: 'Media',
          due: madridDate(),
          description: example.description,
          nextStep: 'Revisar los contratos afectados.',
          dependencyIds: example.dependencyIds,
        },
        rationale: 'Ejemplo sintético de tarea verificable.',
      });
      expect(proposal.status).toBe('pending');
      expect(d.require().proposals.find((item) => item.id === proposal.id)?.patch).toMatchObject({
        description: example.description,
        dependencyIds: example.dependencyIds,
      });
      expect(d.snapshot().records.some((item) => item.title === example.title)).toBe(false);
    }
  });
  it('permite proponer creación de tareas con dependencias autorizadas del mismo proyecto y las aplica al aceptar', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto Alpha' });
    const otherProject = d.save('project', { ...blank('project'), title: 'Proyecto Beta' });
    const first = task({ project: project.id, title: 'Diseñar arquitectura' });
    const second = task({ project: project.id, title: 'Configurar entorno' });
    const foreign = task({ project: otherProject.id, title: 'Tarea externa' });

    d.settings({ companyAuthorized: true, universityStructure: '' });
    const { token } = d.grant('codex', [], 'projects', [project.id]);
    const auth = d.authorize(token);

    expect(() =>
      d.propose(auth, {
        operation: 'create',
        kind: 'task',
        patch: { project: project.id, title: 'Tarea incompleta' },
        rationale: 'Faltan campos de gestión',
      }),
    ).toThrow('explícitos');
    expect(() =>
      d.propose(auth, {
        operation: 'create',
        kind: 'incident',
        patch: { project: project.id, title: 'Incidencia sin fecha', description: 'Detalle' },
        rationale: 'Falta la fecha',
      }),
    ).toThrow('explícitos');

    const proposal = d.propose(auth, {
      operation: 'create',
      kind: 'task',
      patch: {
        project: project.id,
        title: 'Implementar servicios',
        due: madridDate(),
        phase: 'Implementación',
        priority: 'Alta',
        description: 'Objetivo: implementar servicios. Criterios: integración verificada.',
        nextStep: 'Revisar contratos.',
        dependencyIds: [first.id, second.id],
      },
      rationale: 'Depende del diseño y del entorno previo',
    });

    expect(proposal.status).toBe('pending');
    const stored = d.require().proposals.find((p) => p.id === proposal.id);
    expect(stored?.patch.dependencyIds).toEqual([first.id, second.id]);

    // Rechaza dependencias no autorizadas / de otro proyecto
    expect(() =>
      d.propose(auth, {
        operation: 'create',
        kind: 'task',
        patch: {
          project: project.id,
          title: 'Tarea con dependencia externa',
          due: madridDate(),
          phase: 'Implementación',
          priority: 'Media',
          description: 'Comprobar la dependencia externa.',
          nextStep: 'Revisar la autorización.',
          dependencyIds: [foreign.id],
        },
        rationale: 'Prueba ajena',
      }),
    ).toThrow('no está autorizada');

    // Rechaza dependencias inexistentes
    expect(() =>
      d.propose(auth, {
        operation: 'create',
        kind: 'task',
        patch: {
          project: project.id,
          title: 'Tarea con dependencia rota',
          due: madridDate(),
          phase: 'Implementación',
          priority: 'Media',
          description: 'Comprobar la dependencia inexistente.',
          nextStep: 'Revisar la autorización.',
          dependencyIds: ['non-existent-id'],
        },
        rationale: 'Prueba rota',
      }),
    ).toThrow('no está autorizada');

    // Rechaza dependencias circulares en actualización
    expect(() =>
      d.propose(auth, {
        operation: 'update',
        kind: 'task',
        targetId: first.id,
        expectedVersion: first.version,
        patch: {
          dependencyIds: [first.id],
        },
        rationale: 'Ciclo directo',
      }),
    ).toThrow('ciclo');

    // Acepta la propuesta válida e incorpora dependencyIds
    d.review(proposal.id, true);
    const created = d
      .require()
      .records.find((r): r is Task => r.kind === 'task' && r.title === 'Implementar servicios');
    expect(created).toBeDefined();
    expect(created?.dependencyIds).toEqual([first.id, second.id]);
    expect(created?.project).toBe(project.id);
  });
  it('las prácticas propuestas son borradores sin autoridad', () => {
    const t = task();
    const { auth } = grant(t.id);
    const p = d.propose(auth, {
      operation: 'create',
      kind: 'practice',
      patch: { title: 'Sugerencia', explanation: 'Revisar riesgos' },
      rationale: 'Mejora',
    });
    d.review(p.id, true);
    const created = d.require().records.find((r) => r.title === 'Sugerencia') as Practice;
    expect(created.status).toBe('Borrador');
    expect(created.mandatory).toBe(false);
  });
  it('impide leer criterios internos por su asociación a una tarea', () => {
    const t = task();
    const { auth } = grant(t.id);
    expect(d.context(auth, { taskId: t.id, kind: 'practice' }).items).toEqual([]);
  });
  it('limita el tamaño y página del contexto', () => {
    const t = task();
    const { auth } = grant(t.id);
    expect(() => d.context(auth, { limit: 1000 })).toThrow();
    expect(JSON.stringify(d.context(auth, { limit: 10 })).length).toBeLessThan(12500);
  });
  it('pagina el texto de un registro grande sin devolver una página vacía', () => {
    const project = d.save('project', {
      ...blank('project'),
      title: 'Proyecto extenso',
      specifications: 'detalle '.repeat(1900),
    });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const auth = d.authorize(d.grant('codex', [], 'projects', [project.id]).token);
    const first = d.context(auth, { recordIds: [project.id] });
    expect(first.items).toHaveLength(1);
    expect(first.nextExcerptOffset).toBeGreaterThan(0);
    expect(JSON.stringify(first).length).toBeLessThan(12000);
    const second = d.context(auth, {
      recordIds: [project.id],
      excerptOffset: first.nextExcerptOffset,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextExcerptOffset).toBeUndefined();
    expect((first.items[0].excerpt ?? '') + (second.items[0].excerpt ?? '')).toContain(
      'detalle '.repeat(1900),
    );
    expect(() => d.context(auth, { excerptOffset: 1 })).toThrow('solo registro');
  });
  it('filtra y resume solo proyectos autorizados y oculta relaciones con otros proyectos', () => {
    const selected = d.save('project', { ...blank('project'), title: 'Proyecto elegido' });
    const hidden = d.save('project', { ...blank('project'), title: 'Proyecto oculto' });
    const own = task({ project: selected.id, title: 'Tarea propia', state: 'En curso' });
    const other = task({ project: hidden.id, title: 'Tarea ajena' });
    const entry = d.save('entry', {
      ...blank('entry'),
      project: selected.id,
      title: 'Entrada vinculada',
      taskIds: [own.id, other.id],
    });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const { token } = d.grant('codex', [], 'projects', [selected.id]);
    const auth = d.authorize(token);
    expect(d.sessionInfo(auth).projects).toEqual([{ id: selected.id, title: selected.title }]);
    expect(d.filterRecords(auth, { kind: 'task', state: 'En curso' }).items).toMatchObject([
      { id: own.id, title: 'Tarea propia' },
    ]);
    expect(() => d.filterRecords(auth, { kind: 'task', state: 'En curso', limit: 11 })).toThrow();
    expect(() => d.filterRecords(auth, { projectId: hidden.id })).toThrow('autorizado');
    expect(() => d.filterRecords(auth, { from: '2026-02-30' })).toThrow();
    expect(d.projectSummary(auth, { projectId: selected.id }).counts.task).toBe(1);
    expect(() => d.projectSummary(auth, { projectId: hidden.id })).toThrow('autorizado');
    const relations = d.relatedRecords(auth, { recordId: entry.id });
    expect(relations.items.map((item) => item.id)).toEqual([own.id]);
    expect(() => d.relatedRecords(auth, { recordId: other.id })).toThrow('autorizado');
  });
  it('busca por el extracto sin enviarlo y permite leer solo los resultados elegidos', () => {
    const first = task({ title: 'Original privado A' });
    const second = task({ title: 'Original privado B' });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const shares = [first, second].map((record, index) =>
      d.share({
        recordId: record.id,
        provider: 'codex',
        title: `Fuente ${index + 1}`,
        excerpt: `tema compartido ${'x'.repeat(3500)}`,
      }),
    );
    const { token } = d.grant(
      'codex',
      shares.map((share) => share.id),
    );
    const auth = d.authorize(token);
    const summary = d.context(auth, { query: 'tema compartido', limit: 1 }, true);
    expect(summary.items).toEqual([
      { id: first.id, kind: 'task', version: first.version, title: 'Fuente 1' },
    ]);
    expect(summary.nextOffset).toBe(1);
    expect(JSON.stringify(summary)).not.toContain('tema compartido');
    expect(d.context(auth, { query: 'tema compartido', offset: 1 }, true).items[0].id).toBe(
      second.id,
    );
    const selected = d.context(auth, { recordIds: [second.id] });
    expect(selected.items).toMatchObject([{ id: second.id, excerpt: shares[1].excerpt }]);
    expect(JSON.stringify(summary).length).toBeLessThan(JSON.stringify(selected).length / 10);
  });
});
describe('informes', () => {
  it('no exporta textos de políticas ni notas internas en memoria', () => {
    const p = practice({ title: 'NORMA PRIVADA', explanation: 'TEXTO PRIVADO' });
    const t = task();
    d.save(
      'task',
      { ...t, checks: t.checks.map((c) => ({ ...c, state: 'Cumplido', note: 'NOTA PRIVADA' })) },
      t.id,
      t.version,
    );
    const out = memoryReport(d.require().records);
    expect(out).not.toContain('NORMA PRIVADA');
    expect(out).not.toContain('TEXTO PRIVADO');
    expect(out).not.toContain('NOTA PRIVADA');
  });
  it('incluye referencias y consultas; no duplica el mismo registro en el listado de fuentes', () => {
    practice({ title: 'Revisión técnica' });
    const t = task();
    d.save(
      'task',
      {
        ...t,
        checks: t.checks.map((c) => ({
          ...c,
          state: 'Requiere consulta',
          note: 'Consultar al tutor',
        })),
        blocked: 'Faltan permisos',
      },
      t.id,
      t.version,
    );
    const report = weeklyReport(
      d.require().records,
      new Date(Date.now() - 86400000).toISOString(),
      new Date(Date.now() + 1000).toISOString(),
    );
    expect(report.body).toContain('Consultar al tutor');
    expect(report.body).toContain(t.id);
    expect(new Set(report.sourceIds).size).toBe(report.sourceIds.length);
  });
});

describe('fecha real de finalización y entradas diarias', () => {
  it('registra fecha real de finalización al completar una tarea con vencimiento posterior', () => {
    const t = task({ due: '2026-09-30' });
    const completed = d.save(
      'task',
      { ...t, state: 'Completada', completedAt: '2026-09-29' },
      t.id,
      t.version,
    ) as Task;
    expect(completed.state).toBe('Completada');
    expect(completed.due).toBe('2026-09-30');
    expect(completed.completedAt).toBe('2026-09-29T12:00:00.000Z');
    expect(taskCompletionDay(completed)).toBe('2026-09-29');
    expect(isTaskCompletedOnDay(completed, '2026-09-29')).toBe(true);
    expect(isTaskCompletedOnDay(completed, '2026-09-30')).toBe(false);
  });

  it('asigna automáticamente la fecha actual si no se proporciona completedAt explícito al completar', () => {
    const t = task({ due: '2026-09-30' });
    const completed = d.save('task', { ...t, state: 'Completada' }, t.id, t.version) as Task;
    expect(completed.state).toBe('Completada');
    expect(completed.completedAt).toBeTruthy();
    expect(taskCompletionDay(completed)).toBe(madridDate());
    expect(isTaskCompletedOnDay(completed, madridDate())).toBe(true);
  });

  it('elimina completedAt si la tarea se reabre a Por hacer o En curso', () => {
    const t = task({ due: '2026-09-30' });
    const completed = d.save(
      'task',
      { ...t, state: 'Completada', completedAt: '2026-09-29' },
      t.id,
      t.version,
    ) as Task;
    expect(completed.completedAt).toBeDefined();

    const reopened = d.save(
      'task',
      { ...completed, state: 'En curso' },
      completed.id,
      completed.version,
    ) as Task;
    expect(reopened.state).toBe('En curso');
    expect(reopened.completedAt).toBeUndefined();
    expect(taskCompletionDay(reopened)).toBeUndefined();
    expect(isTaskCompletedOnDay(reopened, '2026-09-29')).toBe(false);
  });

  it('asocia automáticamente tareas efectivamente completadas en ese día al guardar la entrada diaria', () => {
    // Tarea con vencimiento el día 30, pero finalizada efectivamente el día 29
    const t1 = task({ title: 'Tarea adelantada', due: '2026-09-30' });
    const completed1 = d.save(
      'task',
      { ...t1, state: 'Completada', completedAt: '2026-09-29' },
      t1.id,
      t1.version,
    ) as Task;

    // Tarea sin completar para el día 29
    const t2 = task({ title: 'Tarea pendiente', due: '2026-09-29' });

    // Guardar entrada para el día 29
    const entry = d.save('entry', {
      ...blank('entry'),
      date: '2026-09-29',
      title: 'Avances del 2026-09-29',
      activity: 'Jornada de avance',
      taskIds: [],
    }) as Entry;

    expect(entry.taskIds).toContain(completed1.id);
    expect(entry.taskIds).not.toContain(t2.id);
  });

  it('permite configurar la duración de sesiones MCP dentro del rango seguro (15m - 8h)', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto MCP Duración' });
    d.settings({ companyAuthorized: true, universityStructure: '' });

    // Duración por defecto: 60 minutos
    const gDefault = d.grant('codex', [], 'projects', [project.id]);
    const expDefault = Date.parse(gDefault.expiresAt);
    expect(expDefault - Date.now()).toBeGreaterThan(58 * 60000);
    expect(expDefault - Date.now()).toBeLessThanOrEqual(60 * 60000);

    // Duración mínima permitida: 15 minutos
    const gMin = d.grant('codex', [], 'projects', [project.id], 15);
    const expMin = Date.parse(gMin.expiresAt);
    expect(expMin - Date.now()).toBeGreaterThan(13 * 60000);
    expect(expMin - Date.now()).toBeLessThanOrEqual(15 * 60000);

    // Duración máxima permitida: 480 minutos (8 horas)
    const gMax = d.grant('codex', [], 'projects', [project.id], 480);
    const expMax = Date.parse(gMax.expiresAt);
    expect(expMax - Date.now()).toBeGreaterThan(478 * 60000);
    expect(expMax - Date.now()).toBeLessThanOrEqual(480 * 60000);

    // Límites excedidos o valores inválidos
    expect(() => d.grant('codex', [], 'projects', [project.id], 14)).toThrow(
      'entre 15 minutos y 8 horas',
    );
    expect(() => d.grant('codex', [], 'projects', [project.id], 481)).toThrow(
      'entre 15 minutos y 8 horas',
    );
    expect(() => d.grant('codex', [], 'projects', [project.id], 30.5)).toThrow(
      'entre 15 minutos y 8 horas',
    );
    expect(() => d.grant('codex', [], 'projects', [project.id], '60' as unknown as number)).toThrow(
      'entre 15 minutos y 8 horas',
    );
  });

  it('permite renovar una sesión activa y valida vigencia y duración', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto Renovación' });
    d.settings({ companyAuthorized: true, universityStructure: '' });

    const g = d.grant('codex', [], 'projects', [project.id], 15);
    const initialExpires = Date.parse(g.expiresAt);

    // Renovar a 120 minutos
    const renewed = d.renewGrant(g.id, 120);
    const newExpires = Date.parse(renewed.expiresAt);
    expect(newExpires).toBeGreaterThan(initialExpires);
    expect(newExpires - Date.now()).toBeGreaterThan(118 * 60000);
    expect(newExpires - Date.now()).toBeLessThanOrEqual(120 * 60000);

    // No permite duraciones fuera de rango
    expect(() => d.renewGrant(g.id, 10)).toThrow('entre 15 minutos y 8 horas');
    expect(() => d.renewGrant(g.id, 500)).toThrow('entre 15 minutos y 8 horas');

    // No permite renovar sesión caducada
    d.grants.get(g.id)!.expiresAt = new Date(0).toISOString();
    expect(() => d.renewGrant(g.id, 60)).toThrow('no disponible');
  });

  it('mantiene una sesión por cliente y renueva la existente al crearla de nuevo', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto sesión única' });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const first = d.grant('codex', [], 'projects', [project.id], 15);
    const other = d.grant('claude', [], 'projects', [project.id]);
    expect(first.renewed).toBe(false);

    const again = d.grant('codex', [], 'projects', [project.id], 120, true);
    expect(again).toMatchObject({ id: first.id, renewed: true });
    expect(Date.parse(again.expiresAt)).toBeGreaterThan(Date.parse(first.expiresAt));
    expect([...d.grants.values()].filter((g) => g.provider === 'codex')).toHaveLength(1);
    expect(d.grants.get(first.id)?.canCompleteTasks).toBe(true);
    // The token rotates with the connector file; the previous one stops working.
    expect(() => d.authorize(first.token)).toThrow('revocada');
    expect(d.authorize(again.token).id).toBe(first.id);
    expect(d.authorize(other.token).provider).toBe('claude');

    d.grants.get(first.id)!.expiresAt = new Date(0).toISOString();
    const replaced = d.grant('codex', [], 'projects', [project.id]);
    expect(replaced.renewed).toBe(false);
    expect(d.grants.has(first.id)).toBe(false);
  });

  it('propone eliminaciones que solo se aplican al aceptarlas', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto borrado' });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const auth = d.authorize(d.grant('codex', [], 'projects', [project.id]).token);
    const entry = d.save('entry', {
      ...blank('entry'),
      title: 'Entrada duplicada',
      project: project.id,
    }) as Entry;
    const remove = (input: Record<string, unknown>) =>
      d.propose(auth, {
        operation: 'delete',
        kind: 'entry',
        targetId: entry.id,
        expectedVersion: entry.version,
        patch: {},
        rationale: 'Duplicada de la entrada del lunes',
        ...input,
      });

    expect(() => remove({ patch: { title: 'Otro' } })).toThrow('no admite patch');
    expect(() => remove({ rationale: '  ' })).toThrow('motivo');
    expect(() => remove({ expectedVersion: entry.version + 1 })).toThrow('no autorizados');
    expect(() =>
      d.propose(auth, {
        operation: 'delete',
        kind: 'project',
        targetId: project.id,
        expectedVersion: project.version,
        patch: {},
        rationale: 'No',
      }),
    ).toThrow('edición humana');
    const mandatory = practice({ project: project.id, mandatory: true });
    expect(() =>
      d.propose(auth, {
        operation: 'delete',
        kind: 'practice',
        targetId: mandatory.id,
        expectedVersion: mandatory.version,
        patch: {},
        rationale: 'Obsoleta',
      }),
    ).toThrow('obligatoria');

    const proposal = remove({});
    expect(proposal.status).toBe('pending');
    expect(remove({}).id).toBe(proposal.id);
    expect(d.require().records.some((r) => r.id === entry.id)).toBe(true);

    expect(d.review(proposal.id, true).status).toBe('accepted');
    expect(d.require().records.some((r) => r.id === entry.id)).toBe(false);
    expect(d.proposalStatus(auth).items).toContainEqual(
      expect.objectContaining({ id: proposal.id, status: 'accepted' }),
    );
  });

  it('no acepta en el mismo lote cambios y eliminación de un registro', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto lote borrado' });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const auth = d.authorize(d.grant('codex', [], 'projects', [project.id]).token);
    const t = task({ project: project.id });
    const update = d.propose(auth, {
      operation: 'update',
      kind: 'task',
      targetId: t.id,
      expectedVersion: t.version,
      patch: { nextStep: 'Revisar' },
      rationale: 'Ajuste',
    });
    const remove = d.propose(auth, {
      operation: 'delete',
      kind: 'task',
      targetId: t.id,
      expectedVersion: t.version,
      patch: {},
      rationale: 'Duplicada',
    });
    expect(() => d.reviewBatch([remove.id, update.id], true)).toThrow('se eliminaría');
    expect(d.require().records.some((r) => r.id === t.id)).toBe(true);
    expect(d.reviewBatch([remove.id], true)[0].status).toBe('accepted');
    expect(d.require().records.some((r) => r.id === t.id)).toBe(false);
    expect(d.require().proposals.find((p) => p.id === update.id)?.status).toBe('rejected');
  });

  it('permite aceptar propuestas en lote mediante reviewBatch', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto Lote' });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const g = d.grant('codex', [], 'projects', [project.id]);
    const auth = d.authorize(g.token);

    const t1 = task({ project: project.id, title: 'Tarea 1' });
    const t2 = task({ project: project.id, title: 'Tarea 2' });

    const p1 = d.propose(auth, {
      operation: 'update',
      kind: 'task',
      targetId: t1.id,
      expectedVersion: t1.version,
      patch: { title: 'Tarea 1 Actualizada' },
      rationale: 'Mejora de título',
    });
    const p2 = d.propose(auth, {
      operation: 'update',
      kind: 'task',
      targetId: t2.id,
      expectedVersion: t2.version,
      patch: { title: 'Tarea 2 Actualizada' },
      rationale: 'Mejora de título 2',
    });

    const reviewed = d.reviewBatch([p1.id, p2.id], true);
    expect(reviewed).toHaveLength(2);
    expect(reviewed[0].status).toBe('accepted');
    expect(reviewed[1].status).toBe('accepted');

    const updated1 = d.require().records.find((r) => r.id === t1.id)!;
    const updated2 = d.require().records.find((r) => r.id === t2.id)!;
    expect(updated1.title).toBe('Tarea 1 Actualizada');
    expect(updated2.title).toBe('Tarea 2 Actualizada');

    // Rechaza si se pasa lista vacía
    expect(() => d.reviewBatch([], true)).toThrow();
  });

  it('reutiliza propuestas pendientes idénticas del mismo proveedor y conserva las distintas', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto Lote' });
    const t = task({ project: project.id });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const codex = d.authorize(d.grant('codex', [], 'projects', [project.id]).token);
    const claude = d.authorize(d.grant('claude', [], 'projects', [project.id]).token);
    const input = {
      operation: 'update',
      kind: 'task',
      targetId: t.id,
      expectedVersion: t.version,
      patch: { title: 'Título revisado', description: 'Descripción' },
      rationale: 'Primer envío',
    };
    const first = d.propose(codex, input);
    const retry = d.propose(codex, {
      ...input,
      patch: { description: 'Descripción', title: 'Título revisado' },
      rationale: 'Reintento',
    });
    expect(retry.id).toBe(first.id);
    expect(d.propose(claude, input).id).not.toBe(first.id);
    expect(d.propose(codex, { ...input, patch: { title: 'Otro título' } }).id).not.toBe(first.id);
    expect(d.require().proposals).toHaveLength(3);
    d.review(first.id, false);
    expect(d.propose(codex, input).id).not.toBe(first.id);
  });

  it('acepta verificaciones y cierre del mismo registro encadenando versiones', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto Lote' });
    const first = practice({ project: project.id, mandatory: true, title: 'Primer criterio' });
    const second = practice({ project: project.id, mandatory: true, title: 'Segundo criterio' });
    const t = task({ project: project.id, state: 'En curso' });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const auth = d.authorize(d.grant('codex', [], 'projects', [project.id]).token);
    const checks = [first, second].map((criterion) =>
      d.propose(auth, {
        operation: 'check',
        kind: 'task',
        targetId: t.id,
        expectedVersion: t.version,
        patch: { practiceId: criterion.id, state: 'Cumplido', note: 'Verificado en pruebas.' },
        rationale: 'Evidencia',
      }),
    );
    const close = d.propose(auth, {
      operation: 'update',
      kind: 'task',
      targetId: t.id,
      expectedVersion: t.version,
      patch: { state: 'Completada', solution: 'Verificaciones realizadas.' },
      rationale: 'Cierre',
    });
    expect(
      d.propose(auth, {
        operation: 'update',
        kind: 'task',
        targetId: t.id,
        expectedVersion: t.version,
        patch: { state: 'Completada', solution: 'Verificaciones realizadas.' },
        rationale: 'Reintento',
      }).id,
    ).toBe(close.id);
    const reviewed = d.reviewBatch([close.id, ...checks.map((p) => p.id)], true);
    expect(reviewed.map((p) => p.operation)).toEqual(['check', 'check', 'update']);
    const completed = d.require().records.find((record) => record.id === t.id) as Task;
    expect(completed.state).toBe('Completada');
    expect(completed.version).toBe(t.version + 4);
    expect(completed.checks.filter((check) => check.state === 'Cumplido')).toHaveLength(2);
  });

  it('solo permite al MCP completar con permiso y evidencias de todos los criterios', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto cierre' });
    const criterion = practice({ project: project.id, mandatory: true });
    const t = task({ project: project.id, state: 'En curso' });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const ordinary = d.authorize(d.grant('claude', [], 'projects', [project.id]).token);
    const allowed = d.authorize(d.grant('codex', [], 'projects', [project.id], 60, true).token);
    const check = d.propose(allowed, {
      operation: 'check',
      kind: 'task',
      targetId: t.id,
      expectedVersion: t.version,
      patch: {
        practiceId: criterion.id,
        state: 'Cumplido',
        note: 'Prueba y compilación verificadas.',
      },
      rationale: 'Evidencia técnica',
    });
    const close = d.propose(allowed, {
      operation: 'update',
      kind: 'task',
      targetId: t.id,
      expectedVersion: t.version,
      patch: { state: 'Completada', solution: 'Cambio probado y compilado.' },
      rationale: 'Cierre técnico',
    });
    const input = { taskId: t.id, closureId: close.id, checkIds: [check.id] };
    expect(() => d.completeTask(ordinary, input)).toThrow('no permite');
    expect(() => d.completeTask(allowed, { ...input, checkIds: [] })).toThrow('Faltan evidencias');
    expect(() => d.completeTask(allowed, { ...input, checkIds: [check.id, check.id] })).toThrow(
      'repetida',
    );
    expect(d.completeTask(allowed, input).map((p) => p.status)).toEqual(['accepted', 'accepted']);
    expect((d.require().records.find((r) => r.id === t.id) as Task).state).toBe('Completada');
  });

  it('exige evidencia y vigencia del criterio al proponer y aceptar verificaciones', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto criterios' });
    const criterion = practice({ project: project.id, mandatory: true });
    const t = task({ project: project.id });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const auth = d.authorize(d.grant('codex', [], 'projects', [project.id]).token);
    const input = {
      operation: 'check',
      kind: 'task',
      targetId: t.id,
      expectedVersion: t.version,
      patch: { practiceId: criterion.id, state: 'Cumplido', note: 'Prueba verificada.' },
      rationale: 'Evidencia técnica',
    };
    expect(() => d.propose(auth, { ...input, patch: { ...input.patch, note: '  ' } })).toThrow(
      'evidencias',
    );
    const proposal = d.propose(auth, input);
    d.save(
      'practice',
      { ...criterion, title: 'Criterio revisado' },
      criterion.id,
      criterion.version,
    );
    expect(() =>
      d.propose(auth, { ...input, patch: { ...input.patch, note: 'Otra prueba.' } }),
    ).toThrow('versión actualizada');
    expect(() => d.review(proposal.id, true)).toThrow('versión actualizada');
    expect(d.require().proposals.find((p) => p.id === proposal.id)?.status).toBe('pending');
  });
  it('permite al MCP verificar un criterio vigente asociado manualmente', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto criterios' });
    const criterion = practice({ project: project.id, phases: ['Diseño'] });
    const t = task({ project: project.id, phase: 'Implementación' });
    expect(t.checks).toHaveLength(0);
    const associated = d.save(
      'task',
      { ...t, checks: [snapshotCheck(criterion)] },
      t.id,
      t.version,
    ) as Task;
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const auth = d.authorize(d.grant('codex', [], 'projects', [project.id]).token);
    const proposal = d.propose(auth, {
      operation: 'check',
      kind: 'task',
      targetId: t.id,
      expectedVersion: associated.version,
      patch: { practiceId: criterion.id, state: 'Cumplido', note: 'Revisión documentada.' },
      rationale: 'Se comprobó el criterio asociado.',
    });
    d.review(proposal.id, true);
    const verified = d.require().records.find((r) => r.id === t.id) as Task;
    expect(verified.checks[0]).toMatchObject({ practiceId: criterion.id, state: 'Cumplido' });
  });

  it('rechaza cambios incompatibles y obsoletos sin aplicar parcialmente el lote', () => {
    const project = d.save('project', { ...blank('project'), title: 'Proyecto Lote' });
    const t = task({ project: project.id });
    d.settings({ companyAuthorized: true, universityStructure: '' });
    const auth = d.authorize(d.grant('codex', [], 'projects', [project.id]).token);
    const make = (title: string) =>
      d.propose(auth, {
        operation: 'update',
        kind: 'task',
        targetId: t.id,
        expectedVersion: t.version,
        patch: { title },
        rationale: 'Cambio',
      });
    const first = make('Primer título');
    const second = make('Segundo título');
    expect(() => d.reviewBatch([first.id, second.id], true)).toThrow('campo title');
    expect(d.require().records.find((record) => record.id === t.id)?.title).toBe(t.title);
    expect(d.require().proposals.filter((p) => p.status === 'pending')).toHaveLength(2);
    expect(() => d.reviewBatch([first.id, first.id], true)).toThrow('repetida');
    expect(() => d.reviewBatch([first.id, first.id], false)).toThrow('repetida');
    const current = d.require().records.find((record) => record.id === t.id) as Task;
    d.save('task', { ...current, description: 'Edición humana' }, t.id, current.version);
    expect(() => d.reviewBatch([first.id], true)).toThrow('registro cambió');
  });

  it('permite eliminar una práctica o criterio y retira sus verificaciones asociadas en tareas', () => {
    const pr = practice({ title: 'Criterio a borrar', status: 'Recomendación personal' });
    const t = task({ title: 'Tarea con criterio' });
    expect(t.checks.some((c) => c.practiceId === pr.id)).toBe(true);

    d.deletePractice(pr.id, pr.version);

    expect(d.require().records.some((r) => r.id === pr.id)).toBe(false);
    const updatedTask = d.require().records.find((r) => r.id === t.id) as Task;
    expect(updatedTask.checks.some((c) => c.practiceId === pr.id)).toBe(false);
  });

  it('no asocia prácticas en Borrador ni Retirada a tareas y las limpia si cambian de estado', async () => {
    // Prácticas iniciales
    const pBorrador = practice({ title: 'Criterio en borrador', status: 'Borrador' });
    const pRetirada = practice({ title: 'Criterio retirado', status: 'Retirada' });
    const pActiva = practice({ title: 'Criterio activo', status: 'Recomendación personal' });

    // Nueva tarea creada: sólo debe tener la activa
    const t = task({ title: 'Tarea de prueba criterios' });
    expect(t.checks.some((c) => c.practiceId === pBorrador.id)).toBe(false);
    expect(t.checks.some((c) => c.practiceId === pRetirada.id)).toBe(false);
    expect(t.checks.some((c) => c.practiceId === pActiva.id)).toBe(true);

    // Si la activa pasa a borrador, se desvincula de las tareas automáticamente
    d.save('practice', { ...pActiva, status: 'Borrador' }, pActiva.id, pActiva.version);
    const taskAfterDraft = d.require().records.find((r) => r.id === t.id) as Task;
    expect(taskAfterDraft.checks.some((c) => c.practiceId === pActiva.id)).toBe(false);

    // Si el borrador pasa a activa, se vincula automáticamente
    const pBorradorActual = d.require().records.find((r) => r.id === pBorrador.id) as Practice;
    d.save(
      'practice',
      { ...pBorradorActual, status: 'Recomendación personal' },
      pBorradorActual.id,
      pBorradorActual.version,
    );
    const taskAfterActivate = d.require().records.find((r) => r.id === t.id) as Task;
    expect(taskAfterActivate.checks.some((c) => c.practiceId === pBorrador.id)).toBe(true);

    // Al bloquear y desbloquear, el sync de unlock limpia cualquier criterio obsoleto
    d.lock();
    await d.unlock(pass);
    const taskAfterUnlock = d.require().records.find((r) => r.id === t.id) as Task;
    expect(taskAfterUnlock.checks.some((c) => c.practiceId === pRetirada.id)).toBe(false);
    expect(taskAfterUnlock.checks.some((c) => c.practiceId === pActiva.id)).toBe(false); // sigue en borrador
    expect(taskAfterUnlock.checks.some((c) => c.practiceId === pBorrador.id)).toBe(true); // activa
  });
});
