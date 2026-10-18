import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Domain, blank } from '../service/domain';
import { Vault } from '../service/vault';
import { addDays, occurrenceDays, type RecurrenceRule } from '../shared/recurrence';
import { madridDate, type Task, type TaskSeries } from '../shared/model';

const password = 'contraseña extensa de prueba';
let dir: string;
let domain: Domain;
let project: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bitacora-recurrence-'));
  domain = new Domain(new Vault(dir));
  await domain.unlock(password);
  project = domain.save('project', { ...blank('project'), title: 'Proyecto' }).id;
});

afterEach(() => {
  domain.lock();
  rmSync(dir, { recursive: true, force: true });
});

function template(extra: Record<string, unknown> = {}) {
  return {
    ...blank('task'),
    title: 'Revisión habitual',
    project,
    ...extra,
  };
}

function occurrences(seriesId: string) {
  return domain
    .require()
    .records.filter(
      (record): record is Task =>
        record.kind === 'task' && record.recurrence?.seriesId === seriesId,
    );
}

describe('tareas recurrentes', () => {
  it('calcula límites semanales y meses cortos sin desplazar el día original', () => {
    expect(
      occurrenceDays(
        { frequency: 'weekly', start: '2026-09-28', end: '2026-10-05', weekdays: [1, 3] },
        '2026-09-28',
        '2026-10-05',
      ),
    ).toEqual(['2026-09-28', '2026-09-30', '2026-10-05']);
    expect(
      occurrenceDays(
        { frequency: 'monthly', start: '2027-01-31', end: '2027-03-31', monthDay: 31 },
        '2027-01-31',
        '2027-03-31',
      ),
    ).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(
      occurrenceDays(
        { frequency: 'monthly', start: '2028-01-31', monthDay: 31 },
        '2028-01-31',
        '2028-03-31',
      ),
    ).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('recupera vencidas, conserva la clave al mover una fecha y no duplica al reabrir', async () => {
    const rule: RecurrenceRule = { frequency: 'weekly', start: '2026-01-05', weekdays: [1] };
    const series = domain.saveTaskSeries(template(), rule);
    domain.reconcileTaskSeries('2026-09-28');
    const firstCount = occurrences(series.id).length;
    expect(firstCount).toBeGreaterThan(35);
    const first = occurrences(series.id)[0];
    domain.save('task', { ...first, due: addDays(first.due, 2) }, first.id, first.version);
    domain.reconcileTaskSeries('2026-09-28');
    expect(occurrences(series.id)).toHaveLength(firstCount);
    domain.lock();
    await domain.unlock(password);
    domain.reconcileTaskSeries('2026-09-28');
    expect(occurrences(series.id)).toHaveLength(firstCount);
    expect(
      occurrences(series.id).find((task) => task.id === first.id)?.recurrence?.occurrenceDate,
    ).toBe('2026-01-05');
    expect(
      new Set(occurrences(series.id).map((task) => task.recurrence?.occurrenceDate)).size,
    ).toBe(firstCount);
  });

  it('mantiene estado, criterios e historial propios y propaga la plantilla solo al futuro', () => {
    domain.save('practice', {
      ...blank('practice'),
      title: 'Comprobar resultado',
      project,
      status: 'Recomendación personal',
    });
    const start = addDays(madridDate(), 1);
    const series = domain.saveTaskSeries(template(), {
      frequency: 'weekly',
      start,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    });
    domain.reconcileTaskSeries();
    const [first, second] = occurrences(series.id);
    expect(first.checks).toHaveLength(1);
    expect(second.checks).toHaveLength(1);
    const completed = domain.save(
      'task',
      {
        ...first,
        state: 'Completada',
        checks: first.checks.map((check) => ({ ...check, state: 'Cumplido', note: 'Verificado' })),
      },
      first.id,
      first.version,
    ) as Task;
    const changed = domain.save(
      'task',
      { ...second, title: 'Ajuste individual' },
      second.id,
      second.version,
    ) as Task;
    domain.saveTaskSeries(
      template({ title: 'Nuevo título', description: 'Nueva pauta' }),
      series.rule,
      series.id,
      series.version,
    );
    const tasks = occurrences(series.id);
    expect(tasks.find((task) => task.id === completed.id)?.title).toBe('Revisión habitual');
    expect(tasks.find((task) => task.id === changed.id)?.title).toBe('Ajuste individual');
    expect(tasks.find((task) => task.id === changed.id)?.description).toBe('Nueva pauta');
    expect(tasks[2].title).toBe('Nuevo título');
    expect(tasks.find((task) => task.id === changed.id)?.checks[0].state).toBe('Pendiente');
    expect(tasks.find((task) => task.id === completed.id)?.checks[0].state).toBe('Cumplido');
    expect(domain.require().history.some((entry) => entry.recordId === completed.id)).toBe(true);
    expect(domain.require().history.some((entry) => entry.recordId === changed.id)).toBe(true);
  });

  it('detiene futuras apariciones sin borrar tareas ni historia', () => {
    const start = addDays(madridDate(), 1);
    const series: TaskSeries = domain.saveTaskSeries(template(), {
      frequency: 'weekly',
      start,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    });
    domain.reconcileTaskSeries();
    const count = occurrences(series.id).length;
    domain.stopTaskSeries(series.id, series.version);
    expect(occurrences(series.id)).toHaveLength(count);
    expect(occurrences(series.id).every((task) => task.recurrence?.canceledAt)).toBe(true);
    domain.reconcileTaskSeries(addDays(madridDate(), 5));
    expect(occurrences(series.id)).toHaveLength(count);
    expect(
      domain.require().taskSeriesHistory?.filter((entry) => entry.seriesId === series.id),
    ).toHaveLength(2);
  });

  it('cancela fechas excluidas al cambiar la regla y reactiva la misma instancia al recuperarlas', () => {
    const start = addDays(madridDate(), 1);
    const daily: RecurrenceRule = {
      frequency: 'weekly',
      start,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    };
    const series = domain.saveTaskSeries(template(), daily);
    domain.reconcileTaskSeries();
    const second = occurrences(series.id)[1];
    const weekday = new Date(`${start}T12:00:00Z`).getUTCDay() || 7;
    const narrowed = domain.saveTaskSeries(
      template(),
      {
        frequency: 'weekly',
        start,
        weekdays: [weekday],
      },
      series.id,
      series.version,
    );
    expect(
      occurrences(series.id).find((task) => task.id === second.id)?.recurrence?.cancellationReason,
    ).toBe('rule');
    domain.saveTaskSeries(template(), daily, narrowed.id, narrowed.version);
    const revived = occurrences(series.id).find((task) => task.id === second.id);
    expect(revived?.recurrence?.canceledAt).toBeUndefined();
    domain.reconcileTaskSeries();
    expect(
      occurrences(series.id).filter(
        (task) => task.recurrence?.occurrenceDate === second.recurrence?.occurrenceDate,
      ),
    ).toHaveLength(1);
  });

  it('rechaza campos de vínculo falsificados en una tarea ordinaria', () => {
    expect(() =>
      domain.save('task', {
        ...template(),
        recurrence: { seriesId: 'falso', occurrenceDate: madridDate(), overriddenFields: [] },
      }),
    ).toThrow('La serie se gestiona');
  });
});
