import { describe, expect, it } from 'vitest';
import type { Task } from '../shared/model';
import {
  BOARD_FILTERS_KEY,
  TODAY_FILTERS_KEY,
  compareBoardTasks,
  emptyTaskFilters,
  filterBoardTasks,
  filterTasks,
  hasActiveFilters,
  isOverdueTask,
  nextRecurringTasks,
  readSavedFilters,
  saveFilters,
  type TaskFilters,
} from '../src/taskFilters';

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

const sampleTasks: Task[] = [
  {
    id: 'task-1',
    kind: 'task',
    version: 1,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    title: 'Tarea Uno',
    project: 'p1',
    type: 'Frontend',
    phase: 'Implementación',
    state: 'Por hacer',
    priority: 'Alta',
    due: '2026-03-10',
    tags: ['ui', 'urgente'],
    blocked: '',
    nextStep: 'Maquetar',
    description: 'Descripción 1',
    solution: '',
    dependencyIds: [],
    checks: [],
  },
  {
    id: 'task-2',
    kind: 'task',
    version: 1,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    title: 'Tarea Dos',
    project: 'p1',
    type: 'Backend',
    phase: 'Diseño',
    state: 'En curso',
    priority: 'Media',
    due: '2026-03-15',
    tags: ['api'],
    blocked: 'Falta acceso',
    nextStep: 'Conectar DB',
    description: 'Descripción 2',
    solution: '',
    dependencyIds: ['task-1'],
    checks: [],
  },
];

describe('recurring tasks in board and list', () => {
  it('shows the earliest unfinished occurrence and advances after completion', () => {
    const occurrence = (id: string, due: string, state: Task['state'] = 'Por hacer'): Task => ({
      ...sampleTasks[0],
      id,
      due,
      state,
      recurrence: { seriesId: 'series-1', occurrenceDate: due, overriddenFields: [] },
    });
    const first = occurrence('first', '2026-03-10');
    const second = occurrence('second', '2026-03-17');
    const third = occurrence('third', '2026-03-24');
    const tasks = [third, sampleTasks[1], second, first];

    expect(nextRecurringTasks(tasks).map((task) => task.id)).toEqual(['task-2', 'first']);
    expect(
      nextRecurringTasks([third, sampleTasks[1], second, { ...first, state: 'Completada' }]).map(
        (task) => task.id,
      ),
    ).toEqual(['task-2', 'second']);
    expect(
      nextRecurringTasks([
        third,
        { ...second, recurrence: { ...second.recurrence!, canceledAt: '2026-03-01' } },
        { ...first, state: 'Completada' },
      ]).map((task) => task.id),
    ).toEqual(['third']);
  });
});

describe('taskFilters persistence and filtering', () => {
  it('retorna emptyTaskFilters cuando el almacenamiento está vacío o es inválido', () => {
    const storage = createMockStorage();
    expect(readSavedFilters(TODAY_FILTERS_KEY, storage)).toEqual(emptyTaskFilters);

    storage.setItem(TODAY_FILTERS_KEY, 'invalid json');
    expect(readSavedFilters(TODAY_FILTERS_KEY, storage)).toEqual(emptyTaskFilters);

    storage.setItem(TODAY_FILTERS_KEY, JSON.stringify('not an object'));
    expect(readSavedFilters(TODAY_FILTERS_KEY, storage)).toEqual(emptyTaskFilters);
  });

  it('guarda filtros activos y los recupera fielmente', () => {
    const storage = createMockStorage();
    const activeFilters: TaskFilters = {
      ...emptyTaskFilters,
      priority: ['Alta', 'Media'],
      type: ['Frontend', 'Backend'],
      phase: ['Diseño', 'Implementación'],
      state: ['Por hacer', 'En curso'],
      tag: ['urgente', 'api'],
      blocked: ['blocked', 'waiting'],
    };

    saveFilters(TODAY_FILTERS_KEY, activeFilters, storage);
    expect(storage.getItem(TODAY_FILTERS_KEY)).toBeTruthy();

    const restored = readSavedFilters(TODAY_FILTERS_KEY, storage);
    expect(restored).toEqual(activeFilters);
  });

  it('elimina la clave del almacenamiento cuando todos los filtros están vacíos', () => {
    const storage = createMockStorage();
    saveFilters(BOARD_FILTERS_KEY, { ...emptyTaskFilters, state: ['En curso'] }, storage);
    expect(storage.getItem(BOARD_FILTERS_KEY)).toBeTruthy();

    saveFilters(BOARD_FILTERS_KEY, { ...emptyTaskFilters }, storage);
    expect(storage.getItem(BOARD_FILTERS_KEY)).toBeNull();
    expect(readSavedFilters(BOARD_FILTERS_KEY, storage)).toEqual(emptyTaskFilters);
  });

  it('migra selecciones individuales guardadas y descarta valores inválidos', () => {
    const storage = createMockStorage();
    storage.setItem(
      TODAY_FILTERS_KEY,
      JSON.stringify({
        type: 'Frontend',
        phase: 'Diseño',
        state: ['En curso', 42, 'En curso'],
        priority: 'Alta',
        tag: 'urgente',
        blocked: 'waiting',
      }),
    );
    expect(readSavedFilters(TODAY_FILTERS_KEY, storage)).toMatchObject({
      type: ['Frontend'],
      phase: ['Diseño'],
      state: ['En curso'],
      priority: ['Alta'],
      tag: ['urgente'],
      blocked: ['waiting'],
    });
    expect(hasActiveFilters(emptyTaskFilters)).toBe(false);
    expect(hasActiveFilters({ ...emptyTaskFilters, type: ['Frontend'] })).toBe(true);
  });

  it('une opciones del mismo grupo y combina grupos distintos', () => {
    const moreTasks = [
      ...sampleTasks,
      { ...sampleTasks[0], id: 'task-3', type: 'Backend', state: 'Completada' as const },
    ];
    const filters = {
      ...emptyTaskFilters,
      type: ['Frontend', 'Backend'],
      phase: ['Diseño', 'Implementación'],
      state: ['Por hacer', 'En curso'],
    };
    expect(filterTasks(moreTasks, filters, moreTasks).map((task) => task.id)).toEqual([
      'task-1',
      'task-2',
    ]);
    expect(
      filterTasks(moreTasks, { ...filters, phase: ['Diseño'] }, moreTasks).map((task) => task.id),
    ).toEqual(['task-2']);
  });

  it('filtra tareas por múltiples criterios combinados', () => {
    const highPriority = filterTasks(
      sampleTasks,
      { ...emptyTaskFilters, priority: ['Alta'] },
      sampleTasks,
    );
    expect(highPriority.map((t) => t.id)).toEqual(['task-1']);

    const blocked = filterTasks(
      sampleTasks,
      { ...emptyTaskFilters, blocked: ['blocked'] },
      sampleTasks,
    );
    expect(blocked.map((t) => t.id)).toEqual(['task-2']);

    const waiting = filterTasks(
      sampleTasks,
      { ...emptyTaskFilters, blocked: ['waiting'] },
      sampleTasks,
    );
    expect(waiting.map((t) => t.id)).toEqual(['task-2']);

    expect(
      filterTasks(
        sampleTasks,
        { ...emptyTaskFilters, priority: ['Alta', 'Media'], tag: ['ui', 'api'] },
        sampleTasks,
      ).map((task) => task.id),
    ).toEqual(['task-1', 'task-2']);
    expect(
      filterTasks(
        sampleTasks,
        { ...emptyTaskFilters, blocked: ['clear', 'waiting'] },
        sampleTasks,
      ).map((task) => task.id),
    ).toEqual(['task-1', 'task-2']);
    expect(
      filterTasks(
        sampleTasks,
        { ...emptyTaskFilters, blocked: ['blocked', 'clear'] },
        sampleTasks,
      ).map((task) => task.id),
    ).toEqual(['task-1', 'task-2']);

    const inDateRange = filterTasks(
      sampleTasks,
      { ...emptyTaskFilters, dueFrom: '2026-03-12', dueTo: '2026-03-20' },
      sampleTasks,
    );
    expect(inDateRange.map((t) => t.id)).toEqual(['task-2']);
  });

  it('muestra desde hoy y conserva las vencidas abiertas, incluidas las que están en revisión', () => {
    const today = '2026-03-15';
    const past = { ...sampleTasks[0], due: '2026-03-14' };
    const review = { ...past, id: 'review', state: 'En revisión' as const };
    const completed = { ...past, id: 'completed', state: 'Completada' as const };
    const future = { ...past, id: 'future', due: '2026-03-16' };
    const tasks = [past, review, completed, sampleTasks[1], future];

    expect(isOverdueTask(review, today)).toBe(true);
    expect(isOverdueTask(completed, today)).toBe(false);
    expect(
      filterBoardTasks(tasks, emptyTaskFilters, tasks, today, 'upcoming').map((task) => task.id),
    ).toEqual(['task-1', 'review', 'task-2', 'future']);
    expect(filterBoardTasks(tasks, emptyTaskFilters, tasks, today, 'all')).toHaveLength(5);
    expect(
      filterBoardTasks(
        tasks,
        { ...emptyTaskFilters, dueFrom: '2026-03-14', dueTo: '2026-03-14' },
        tasks,
        today,
        'range',
      ).map((task) => task.id),
    ).toEqual(['task-1', 'review', 'completed']);
  });
});

describe('compareBoardTasks', () => {
  const baseTask: Task = {
    id: 'task-base',
    kind: 'task',
    version: 1,
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
    title: 'Tarea Base',
    project: 'p1',
    type: 'Frontend',
    phase: 'Implementación',
    state: 'Por hacer',
    priority: 'Media',
    due: '2026-03-15',
    tags: [],
    blocked: '',
    nextStep: '',
    description: '',
    solution: '',
    dependencyIds: [],
    checks: [],
  };

  it('ordena primariamente por fecha límite ascendente (due)', () => {
    const overdue = { ...baseTask, id: 't-overdue', due: '2026-03-10' };
    const near = { ...baseTask, id: 't-near', due: '2026-03-12' };
    const later = { ...baseTask, id: 't-later', due: '2026-03-20' };

    const sorted = [later, overdue, near].sort(compareBoardTasks);
    expect(sorted.map((t) => t.id)).toEqual(['t-overdue', 't-near', 't-later']);
  });

  it('ordena secundariamente por prioridad descendente (Alta > Media > Baja) para fechas idénticas', () => {
    const high = { ...baseTask, id: 't-high', priority: 'Alta' as const };
    const medium = { ...baseTask, id: 't-med', priority: 'Media' as const };
    const low = { ...baseTask, id: 't-low', priority: 'Baja' as const };

    const sorted = [low, high, medium].sort(compareBoardTasks);
    expect(sorted.map((t) => t.id)).toEqual(['t-high', 't-med', 't-low']);
  });

  it('ordena terciariamente priorizando tareas desbloqueadas antes que bloqueadas', () => {
    const unblocked = { ...baseTask, id: 't-unblocked', blocked: '' };
    const whitespaceBlocked = { ...baseTask, id: 't-whitespace', blocked: '   ' };
    const blocked = { ...baseTask, id: 't-blocked', blocked: 'Esperando diseño' };

    expect(compareBoardTasks(unblocked, blocked)).toBeLessThan(0);
    expect(compareBoardTasks(blocked, unblocked)).toBeGreaterThan(0);
    expect(compareBoardTasks(whitespaceBlocked, blocked)).toBeLessThan(0);
  });

  it('ordena cuaternariamente por antigüedad de creación ascendente (createdAt FIFO)', () => {
    const older = { ...baseTask, id: 't-older', createdAt: '2026-03-01T08:00:00.000Z' };
    const newer = { ...baseTask, id: 't-newer', createdAt: '2026-03-01T12:00:00.000Z' };

    const sorted = [newer, older].sort(compareBoardTasks);
    expect(sorted.map((t) => t.id)).toEqual(['t-older', 't-newer']);
  });

  it('ordena quinariamente por título alfabético y desempata finalmente por id', () => {
    const titleA = { ...baseTask, id: 't-2', title: 'Alpha' };
    const titleB = { ...baseTask, id: 't-1', title: 'Beta' };
    expect([titleB, titleA].sort(compareBoardTasks).map((t) => t.id)).toEqual(['t-2', 't-1']);

    const sameTitle1 = { ...baseTask, id: 't-a', title: 'Mismo título' };
    const sameTitle2 = { ...baseTask, id: 't-b', title: 'Mismo título' };
    expect([sameTitle2, sameTitle1].sort(compareBoardTasks).map((t) => t.id)).toEqual([
      't-a',
      't-b',
    ]);
  });

  it('resuelve combinaciones multinivel de forma determinista', () => {
    const t1 = {
      ...baseTask,
      id: '1',
      due: '2026-03-10',
      priority: 'Baja' as const,
      title: 'Fecha anterior gana a prioridad',
    };
    const t2 = {
      ...baseTask,
      id: '2',
      due: '2026-03-12',
      priority: 'Alta' as const,
      blocked: '',
      title: 'Alta desbloqueada',
    };
    const t3 = {
      ...baseTask,
      id: '3',
      due: '2026-03-12',
      priority: 'Alta' as const,
      blocked: 'Bloqueada',
      title: 'Alta bloqueada',
    };
    const t4 = {
      ...baseTask,
      id: '4',
      due: '2026-03-12',
      priority: 'Media' as const,
      createdAt: '2026-03-01T07:00:00.000Z',
      title: 'Media más antigua',
    };
    const t5 = {
      ...baseTask,
      id: '5',
      due: '2026-03-12',
      priority: 'Media' as const,
      createdAt: '2026-03-01T09:00:00.000Z',
      title: 'Media más nueva',
    };

    const sorted = [t4, t2, t5, t1, t3].sort(compareBoardTasks);
    expect(sorted.map((t) => t.id)).toEqual(['1', '2', '3', '4', '5']);
  });
});
