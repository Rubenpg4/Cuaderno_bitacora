import { describe, expect, it } from 'vitest';
import { diagnoseTaskQuality } from '../shared/taskQuality';
import type { Check, Practice, Proposal, Task } from '../shared/model';

function task(id: string, change: Partial<Task> = {}): Task {
  return {
    id,
    version: 1,
    kind: 'task',
    createdAt: '',
    updatedAt: '',
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

function practice(change: Partial<Practice> = {}): Practice {
  return {
    id: 'practice',
    version: 1,
    kind: 'practice',
    createdAt: '',
    updatedAt: '',
    title: 'Calidad',
    project: 'active',
    category: 'Calidad técnica',
    explanation: '',
    source: '',
    owner: '',
    status: 'Recomendación personal',
    mandatory: true,
    pinned: false,
    phases: [],
    tags: [],
    ...change,
  };
}

function check(change: Partial<Check> = {}): Check {
  return {
    practiceId: 'practice',
    practiceVersion: 1,
    title: 'Calidad',
    explanation: '',
    source: '',
    mandatory: true,
    state: 'Pendiente',
    note: '',
    authorization: '',
    exceptionReason: '',
    ...change,
  };
}

function closure(targetId: string): Proposal {
  return {
    id: 'proposal',
    provider: 'codex',
    operation: 'update',
    kind: 'task',
    targetId,
    patch: { state: 'Completada' },
    rationale: '',
    status: 'pending',
    createdAt: '',
  };
}

describe('diagnóstico de calidad de tareas', () => {
  it('clasifica señales y cambia con fecha, siguiente paso, dependencia y estado', () => {
    const prerequisite = task('previa');
    const current = task('actual', {
      due: '2026-10-04',
      nextStep: '  ',
      dependencyIds: [prerequisite.id],
    });
    const diagnosed = diagnoseTaskQuality([current, prerequisite], [], [], 'active', '2026-09-28');
    expect(diagnosed.counts).toMatchObject({
      sin_siguiente_paso: 1,
      dependencia_pendiente: 1,
      vencimiento: 1,
    });
    expect(
      diagnosed.items.filter((item) => item.id === current.id).map((item) => item.category),
    ).toEqual(['sin_siguiente_paso', 'dependencia_pendiente', 'vencimiento']);
    expect(
      diagnoseTaskQuality([current, prerequisite], [], [], 'active', '2026-09-27').counts
        .vencimiento,
    ).toBe(0);
    expect(
      diagnoseTaskQuality(
        [
          { ...current, nextStep: 'Seguir' },
          { ...prerequisite, state: 'Completada' },
        ],
        [],
        [],
        'active',
        '2026-10-05',
      ).items,
    ).toEqual([
      expect.objectContaining({
        id: current.id,
        category: 'vencimiento',
        reason: 'Vencida el 2026-10-04.',
      }),
    ]);
    expect(
      diagnoseTaskQuality([{ ...current, state: 'Completada' }], [], [], 'active', '2026-10-05')
        .items,
    ).toEqual([]);
  });

  it('detecta criterios obligatorios vigentes, versiones obsoletas y cierre pendiente', () => {
    const current = task('actual', { checks: [check()] });
    const active = practice();
    const diagnosed = diagnoseTaskQuality(
      [current],
      [active],
      [closure(current.id)],
      'active',
      '2026-09-28',
    );
    expect(diagnosed.counts).toMatchObject({
      criterio_obligatorio_pendiente: 1,
      cierre_pendiente: 1,
    });
    expect(
      diagnoseTaskQuality(
        [{ ...current, checks: [check({ state: 'Cumplido' })] }],
        [active],
        [closure(current.id)],
        'active',
        '2026-09-28',
      ).counts.criterio_obligatorio_pendiente,
    ).toBe(0);
    expect(
      diagnoseTaskQuality(
        [{ ...current, checks: [check({ state: 'Cumplido' })] }],
        [{ ...active, version: 2 }],
        [],
        'active',
        '2026-09-28',
      ).counts.criterio_obligatorio_pendiente,
    ).toBe(1);
    expect(
      diagnoseTaskQuality([task('sin-check')], [active], [], 'active', '2026-09-28').counts
        .criterio_obligatorio_pendiente,
    ).toBe(1);
    expect(
      diagnoseTaskQuality(
        [current],
        [{ ...active, status: 'Retirada' }],
        [{ ...closure(current.id), status: 'accepted' }],
        'active',
        '2026-09-28',
      ).items,
    ).toEqual([]);
  });

  it('excluye otros cuadernos, tareas completadas y ocurrencias posteriores de una serie', () => {
    const recurring = (id: string, due: string) =>
      task(id, {
        due,
        nextStep: '',
        recurrence: {
          seriesId: 'series',
          occurrenceDate: due,
          overriddenFields: [],
        },
      });
    const result = diagnoseTaskQuality(
      [
        recurring('primera', '2026-09-28'),
        recurring('segunda', '2026-10-05'),
        task('ajena', { project: 'foreign', nextStep: '' }),
        task('hecha', { state: 'Completada', nextStep: '' }),
      ],
      [],
      [],
      'active',
      '2026-09-28',
    );
    expect(new Set(result.items.map((item) => item.id))).toEqual(new Set(['primera']));
  });
});
