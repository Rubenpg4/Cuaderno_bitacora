import { describe, expect, it } from 'vitest';
import type { Task } from '../shared/model';
import { balanceWeek, weekPlan, weekStart } from '../src/weeklyReview';

// Miércoles: la semana va del lunes 2026-09-28 al domingo 2026-10-04.
const today = '2026-09-30';
const monday = '2026-09-28';

function task(id: string, change: Partial<Task> = {}): Task {
  return {
    id,
    version: 1,
    kind: 'task',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    title: id,
    project: 'active',
    phase: 'Implementación',
    type: '',
    tags: [],
    priority: 'Media',
    state: 'Por hacer',
    due: '2026-10-20',
    blocked: '',
    nextStep: 'Continuar',
    description: '',
    solution: '',
    dependencyIds: [],
    checks: [],
    ...change,
  };
}

function recurring(id: string, due: string): Task {
  return task(id, {
    due,
    recurrence: { seriesId: 'serie', occurrenceDate: due, overriddenFields: [] },
  });
}

describe('plan semanal', () => {
  it('empieza la semana en lunes', () => {
    expect(weekStart('2026-09-28')).toBe(monday);
    expect(weekStart(today)).toBe(monday);
    expect(weekStart('2026-10-04')).toBe(monday);
    expect(weekStart('2026-10-05')).toBe('2026-10-05');
  });

  it('reparte las tareas abiertas por día y separa atrasadas y posteriores', () => {
    const plan = weekPlan(
      [
        task('lunes', { due: monday }),
        task('hoy-baja', { due: today, priority: 'Baja' }),
        task('hoy-alta', { due: today, priority: 'Alta' }),
        task('hecha', { due: today, state: 'Completada', completedAt: today }),
        task('domingo', { due: '2026-10-04' }),
        task('ajena', { project: 'foreign', due: today }),
        recurring('serie-1', '2026-10-06'),
        recurring('serie-2', '2026-10-13'),
        task('luego', { due: '2026-10-08' }),
      ],
      'active',
      today,
      monday,
    );

    expect(plan.end).toBe('2026-10-04');
    expect(plan.days.map(({ day, past }) => [day, past])).toEqual([
      ['2026-09-28', true],
      ['2026-09-29', true],
      ['2026-09-30', false],
      ['2026-10-01', false],
      ['2026-10-02', false],
      ['2026-10-03', false],
      ['2026-10-04', false],
    ]);
    expect(plan.days[0].tasks).toEqual([]);
    expect(plan.days[2].tasks.map(({ task }) => task.id)).toEqual(['hoy-alta', 'hoy-baja']);
    expect(plan.days[2].done).toBe(1);
    expect(plan.overdue.map(({ task }) => task.id)).toEqual(['lunes']);
    // Una serie solo adelanta su próxima aparición en «Más adelante».
    expect(plan.later.map(({ task }) => task.id)).toEqual(['serie-1', 'luego']);
    expect(plan.laterTotal).toBe(2);
  });

  it('marca señales y no permite el reparto automático de series ni revisiones', () => {
    const dependency = task('previa', { due: today });
    const plan = weekPlan(
      [
        dependency,
        task('espera', { due: today, dependencyIds: [dependency.id], blocked: 'Falta acceso' }),
        task('revisión', { due: today, state: 'En revisión' }),
        recurring('serie', today),
      ],
      'active',
      today,
      monday,
    );
    const byId = new Map(plan.days[2].tasks.map((item) => [item.task.id, item]));

    expect(byId.get('espera')).toMatchObject({
      signals: ['Bloqueada', 'Espera tareas previas'],
      movable: true,
    });
    expect(byId.get('revisión')).toMatchObject({ signals: ['En revisión'], movable: false });
    expect(byId.get('serie')).toMatchObject({ signals: ['Recurrente'], movable: false });
  });

  it('coloca las atrasadas y descarga los días que superan la capacidad', () => {
    const moves = balanceWeek(
      [
        task('atrasada', { due: '2026-09-25', priority: 'Alta' }),
        task('hoy-1', { due: today, priority: 'Alta' }),
        task('hoy-2', { due: today, priority: 'Media' }),
        task('hoy-3', { due: today, priority: 'Baja' }),
        task('jueves', { due: '2026-10-01' }),
      ],
      'active',
      today,
      monday,
      { capacity: 2, includeWeekend: false },
    );

    expect(moves.map(({ task, from, to }) => [task.id, from, to])).toEqual([
      ['atrasada', '2026-09-25', '2026-10-01'],
      ['hoy-3', today, '2026-10-02'],
    ]);
  });

  it('respeta el fin de semana, las dependencias y lo que no se puede mover', () => {
    const before = task('antes', { due: '2026-10-02' });
    const moves = balanceWeek(
      [
        before,
        task('después', { due: '2026-10-02', dependencyIds: [before.id], priority: 'Baja' }),
        task('viernes', { due: '2026-10-02', priority: 'Alta' }),
        task('revisión', { due: '2026-10-02', state: 'En revisión', priority: 'Muy baja' }),
      ],
      'active',
      today,
      monday,
      { capacity: 2, includeWeekend: false },
    );
    // La dependiente no puede adelantarse a su previa ni la revisión moverse: sale lo siguiente.
    expect(moves.map(({ task, to }) => [task.id, to])).toEqual([
      ['antes', '2026-10-01'],
      ['viernes', '2026-10-01'],
    ]);

    const weekend = balanceWeek(
      [task('a', { due: '2026-10-02' }), task('b', { due: '2026-10-02', priority: 'Baja' })],
      'active',
      today,
      monday,
      { capacity: 1, includeWeekend: true },
    );
    expect(weekend.map(({ task, to }) => [task.id, to])).toEqual([['b', '2026-10-03']]);
  });

  it('mueve primero el último paso numerado y nunca adelanta un paso a uno anterior', () => {
    const moves = balanceWeek(
      [
        task('1. Preparar', { due: today, priority: 'Baja' }),
        task('2. Ejecutar', { due: today, priority: 'Alta' }),
      ],
      'active',
      today,
      monday,
      { capacity: 1, includeWeekend: false },
    );
    expect(moves.map(({ task, to }) => [task.id, to])).toEqual([['2. Ejecutar', '2026-10-01']]);

    // Sin la secuencia, «2.» habría pasado al miércoles libre, antes que «1.».
    expect(
      balanceWeek(
        [
          task('1. Preparar', { due: '2026-10-01' }),
          task('2. Ejecutar', { due: '2026-10-02' }),
          task('revisión', { due: '2026-10-02', state: 'En revisión' }),
        ],
        'active',
        today,
        monday,
        { capacity: 1, includeWeekend: false },
      ),
    ).toEqual([]);
  });

  it('recoloca las atrasadas numeradas en su orden', () => {
    const moves = balanceWeek(
      [
        task('2. Ejecutar', { due: '2026-09-25', priority: 'Crítica' }),
        task('1. Preparar', { due: '2026-09-26', priority: 'Baja' }),
      ],
      'active',
      today,
      monday,
      { capacity: 1, includeWeekend: false },
    );
    expect(moves.map(({ task, to }) => [task.id, to])).toEqual([
      ['1. Preparar', today],
      ['2. Ejecutar', '2026-10-01'],
    ]);
  });

  it('señala los pasos numerados fuera de orden dentro del mismo subproyecto', () => {
    const plan = weekPlan(
      [
        task('2. Ejecutar', { due: today }),
        task('1. Preparar', { due: '2026-10-01' }),
        task('1. Otro frente', { due: '2026-10-02', subprojectId: 'otro' }),
      ],
      'active',
      today,
      monday,
    );
    const signals = plan.days.flatMap(({ tasks }) =>
      tasks.map(({ task, signals }) => [task.id, signals]),
    );
    expect(signals).toEqual([
      ['2. Ejecutar', ['Fuera de secuencia']],
      ['1. Preparar', ['Fuera de secuencia']],
      ['1. Otro frente', []],
    ]);
  });

  it('no propone nada cuando la semana ya está equilibrada', () => {
    expect(
      balanceWeek([task('una', { due: today })], 'active', today, monday, {
        capacity: 3,
        includeWeekend: false,
      }),
    ).toEqual([]);
  });
});
