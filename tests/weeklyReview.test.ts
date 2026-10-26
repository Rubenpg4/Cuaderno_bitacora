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

  it('recoloca toda la semana desde hoy llenando cada día hasta la capacidad', () => {
    const { moves, unplaced } = balanceWeek(
      [
        task('atrasada', { due: '2026-09-25', priority: 'Alta' }),
        task('hoy-1', { due: today, priority: 'Alta' }),
        task('hoy-2', { due: today, priority: 'Media' }),
        task('hoy-3', { due: today, priority: 'Baja' }),
        task('viernes', { due: '2026-10-02' }),
      ],
      'active',
      today,
      monday,
      { capacity: 2, includeWeekend: false },
    );

    expect(unplaced).toEqual([]);
    expect(moves.map(({ task, from, to }) => [task.id, from, to])).toEqual([
      ['atrasada', '2026-09-25', today],
      ['hoy-2', today, '2026-10-01'],
      ['hoy-3', today, '2026-10-01'],
    ]);
  });

  it('respeta las dependencias y cuenta lo que no se puede mover', () => {
    const before = task('antes', { due: '2026-10-02' });
    const { moves } = balanceWeek(
      [
        before,
        task('después', { due: '2026-10-02', dependencyIds: [before.id], priority: 'Alta' }),
        task('revisión', { due: today, state: 'En revisión' }),
        recurring('serie', '2026-10-01'),
      ],
      'active',
      today,
      monday,
      { capacity: 1, includeWeekend: false },
    );
    // Hoy y el jueves ya están ocupados por lo que no se mueve; la dependiente va tras su previa.
    expect(moves.map(({ task, to }) => [task.id, to])).toEqual([['después', '2026-10-05']]);
  });

  it('usa el fin de semana solo si se pide y reparte lo que no cabe en las semanas siguientes', () => {
    const friday = ['a', 'b', 'c', 'd', 'e'].map((id) => task(id, { due: '2026-10-02' }));
    const options = { capacity: 1, includeWeekend: true };
    expect(balanceWeek(friday, 'active', today, monday, options).moves.map(({ to }) => to)).toEqual(
      [today, '2026-10-01', '2026-10-03', '2026-10-04'],
    );

    // El lunes siguiente ya tiene una tarea: lo sobrante empieza el martes.
    const { moves } = balanceWeek(
      [...friday, task('lunes', { due: '2026-10-05' })],
      'active',
      today,
      monday,
      { ...options, includeWeekend: false },
    );
    expect(moves.map(({ task, to }) => [task.id, to])).toEqual([
      ['a', today],
      ['b', '2026-10-01'],
      ['d', '2026-10-06'],
      ['e', '2026-10-07'],
    ]);
  });

  it('ordena los pasos numerados y trae a la semana los anteriores previstos más tarde', () => {
    const { moves } = balanceWeek(
      [
        task('3. Revisar', { due: today }),
        task('1. Preparar', { due: '2026-10-01' }),
        task('5. Publicar', { due: '2026-10-01' }),
        task('2. Ejecutar', { due: '2026-10-02' }),
        task('4. Corregir', { due: '2026-10-20' }),
        task('1. Otro frente', { due: '2026-10-02', subprojectId: 'otro' }),
      ],
      'active',
      today,
      monday,
      { capacity: 2, includeWeekend: false },
    );
    expect(moves.map(({ task, to }) => [task.id, to])).toEqual([
      ['1. Preparar', today],
      ['2. Ejecutar', today],
      ['3. Revisar', '2026-10-01'],
      ['4. Corregir', '2026-10-01'],
      ['5. Publicar', '2026-10-02'],
    ]);
  });

  it('recoloca las atrasadas numeradas en su orden', () => {
    const { moves } = balanceWeek(
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

  it('deja donde está lo que no cabe sin romper la secuencia', () => {
    const { moves, unplaced } = balanceWeek(
      [
        task('3. Validar', { due: today, state: 'En revisión' }),
        task('2. Ejecutar', { due: '2026-10-01' }),
        task('4. Publicar', { due: '2026-10-02' }),
      ],
      'active',
      today,
      monday,
      { capacity: 1, includeWeekend: false },
    );
    expect(unplaced.map(({ id }) => id)).toEqual(['2. Ejecutar']);
    expect(moves).toEqual([]);
  });

  it('una semana ya repartida no propone más cambios', () => {
    const tasks = [
      task('atrasada', { due: '2026-09-20' }),
      task('2. Ejecutar', { due: today }),
      task('1. Preparar', { due: '2026-10-02' }),
      task('suelta', { due: today, priority: 'Baja' }),
      task('otra', { due: '2026-10-01' }),
    ];
    const options = { capacity: 2, includeWeekend: false };
    const first = balanceWeek(tasks, 'active', today, monday, options);
    expect(first.moves.length).toBeGreaterThan(0);
    const moved = new Map(first.moves.map(({ task, to }) => [task.id, to]));
    const applied = tasks.map((item) => ({ ...item, due: moved.get(item.id) ?? item.due }));
    expect(balanceWeek(applied, 'active', today, monday, options).moves).toEqual([]);
  });

  it('en una semana futura no toca las atrasadas', () => {
    const { moves } = balanceWeek(
      [
        task('atrasada', { due: '2026-09-20' }),
        task('a', { due: '2026-10-05' }),
        task('b', { due: '2026-10-05', priority: 'Baja' }),
      ],
      'active',
      today,
      '2026-10-05',
      { capacity: 1, includeWeekend: false },
    );
    expect(moves.map(({ task, to }) => [task.id, to])).toEqual([['b', '2026-10-06']]);
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
    ).toEqual({ moves: [], unplaced: [] });
  });
});
