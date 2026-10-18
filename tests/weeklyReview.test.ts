import { describe, expect, it } from 'vitest';
import type { Task } from '../shared/model';
import { weeklyLoad, weeklyReview } from '../src/weeklyReview';

const today = '2026-09-28';

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

describe('revisión semanal', () => {
  it('asigna un solo grupo principal y conserva señales adicionales', () => {
    const dependency = task('dependencia', { due: '2026-10-01' });
    const blocked = task('bloqueada', {
      due: '2026-09-27',
      dependencyIds: [dependency.id],
      nextStep: '',
    });
    const review = task('revisión', { state: 'En revisión' });
    const plan = task('planificar', { nextStep: '  ' });
    const items = weeklyReview([blocked, dependency, review, plan], 'active', today);

    expect(items.map(({ task, group }) => [task.id, group])).toEqual([
      ['bloqueada', 'Desbloquear'],
      ['dependencia', 'Atender'],
      ['planificar', 'Planificar'],
      ['revisión', 'Atender'],
    ]);
    expect(items[0].signals).toEqual(['Vencida', 'Dependencias pendientes', 'Sin siguiente paso']);
    expect(items[0].pendingDependencies.map((item) => item.id)).toEqual(['dependencia']);
    expect(
      weeklyReview([blocked, { ...dependency, state: 'Completada' }], 'active', today)[0].group,
    ).toBe('Atender');
  });

  it('ordena por fecha, prioridad y título y aísla el cuaderno activo', () => {
    const items = weeklyReview(
      [
        task('otra', { project: 'foreign', due: today, nextStep: '' }),
        task('fuera', { due: '2026-10-05' }),
        task('zeta', { due: today, priority: 'Alta' }),
        task('alfa', { due: today, priority: 'Alta' }),
        task('baja', { due: today, priority: 'Baja' }),
        task('completada', { due: today, state: 'Completada' }),
      ],
      'active',
      today,
    );
    expect(items.map(({ task }) => task.id)).toEqual(['alfa', 'zeta', 'baja']);
  });

  it('cuenta solo la carga abierta del cuaderno en los siete días', () => {
    const load = weeklyLoad(
      [
        task('hoy', { due: today }),
        task('fin', { due: '2026-10-04' }),
        task('otro', { project: 'foreign', due: today }),
        task('hecha', { state: 'Completada', due: today }),
      ],
      'active',
      today,
    );
    expect(load.map(({ count }) => count)).toEqual([1, 0, 0, 0, 0, 0, 1]);
  });
});
