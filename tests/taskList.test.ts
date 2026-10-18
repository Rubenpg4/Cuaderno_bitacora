import { describe, expect, it } from 'vitest';
import type { Task } from '../shared/model';
import { sortListTasks } from '../src/taskList';

function task(id: string, changes: Partial<Task>): Task {
  return {
    id,
    kind: 'task',
    version: 1,
    createdAt: '',
    updatedAt: '',
    title: id,
    project: 'p1',
    phase: 'Diseño',
    type: '',
    tags: [],
    priority: 'Media',
    state: 'Por hacer',
    due: '2026-10-01',
    blocked: '',
    nextStep: '',
    description: '',
    solution: '',
    dependencyIds: [],
    checks: [],
    ...changes,
  };
}

describe('orden de la lista de tareas', () => {
  it('combina fecha ascendente y prioridad descendente sin modificar el origen', () => {
    const original = [
      task('baja', { priority: 'Baja' }),
      task('tarde', { due: '2026-10-02', priority: 'Crítica' }),
      task('alta', { priority: 'Alta' }),
    ];
    const result = sortListTasks(original, [
      { field: 'due', direction: 'asc' },
      { field: 'priority', direction: 'desc' },
    ]);

    expect(result.map((item) => item.id)).toEqual(['baja', 'alta', 'tarde']);
    expect(original.map((item) => item.id)).toEqual(['baja', 'tarde', 'alta']);
  });

  it('ordena por estado, fase y título y desempata de forma estable por ID', () => {
    const result = sortListTasks(
      [
        task('z', { title: 'Igual', state: 'En curso', phase: 'Diseño' }),
        task('a', { title: 'Igual', state: 'En curso', phase: 'Diseño' }),
        task('m', { title: 'Antes', state: 'Por hacer', phase: 'Implementación' }),
        task('n', { title: 'Después', state: 'En curso', phase: 'Validación' }),
      ],
      [
        { field: 'state', direction: 'asc' },
        { field: 'phase', direction: 'asc' },
        { field: 'title', direction: 'asc' },
      ],
    );

    expect(result.map((item) => item.id)).toEqual(['m', 'a', 'z', 'n']);
  });

  it('sitúa fases no catalogadas después de las fases conocidas', () => {
    const result = sortListTasks(
      [task('externa', { phase: 'Ajustes' }), task('validación', { phase: 'Validación' })],
      [{ field: 'phase', direction: 'asc' }],
    );

    expect(result.map((item) => item.id)).toEqual(['validación', 'externa']);
  });
});
