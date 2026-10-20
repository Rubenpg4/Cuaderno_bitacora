import { describe, expect, it } from 'vitest';
import type { Proposal, Task } from '../shared/model';
import {
  attachmentSummary,
  batchPreview,
  isTextChange,
  proposalChanges,
} from '../shared/proposalPreview';

const task = {
  id: 'task-1',
  kind: 'task',
  title: 'Tarea',
  version: 3,
  project: 'project-1',
  state: 'En revisión',
  description: 'Antes',
  checks: [{ practiceId: 'practice-1', state: 'Pendiente', note: '', title: 'Pruebas' }],
} as Task;

function proposal(
  id: string,
  patch: Record<string, unknown>,
  operation: Proposal['operation'] = 'update',
): Proposal {
  return {
    id,
    operation,
    kind: 'task',
    targetId: task.id,
    expectedVersion: 3,
    provider: 'codex',
    patch,
    rationale: '',
    status: 'pending',
    createdAt: '',
  };
}

describe('vista previa de propuestas', () => {
  it('omite campos iguales y reservados, y muestra estado anterior al cierre', () => {
    const changes = proposalChanges(
      {
        ...proposal('closure', {
          description: 'Antes',
          state: 'Completada',
          solution: 'Hecho',
          checks: [],
        }),
        previousTaskState: 'En curso',
      },
      task,
    );
    expect(changes).toEqual([
      { field: 'state', before: 'En curso', after: 'Completada' },
      { field: 'solution', before: undefined, after: 'Hecho' },
    ]);
  });

  it('muestra estado y nota del criterio sin exponer sus campos de control', () => {
    const changes = proposalChanges(
      proposal(
        'check',
        {
          practiceId: 'practice-1',
          state: 'Cumplido',
          note: 'Suite verde',
        },
        'check',
      ),
      task,
    );
    expect(changes).toEqual([
      {
        field: 'check:practice-1',
        before: { state: 'Pendiente', note: '' },
        after: { state: 'Cumplido', note: 'Suite verde' },
      },
    ]);
  });

  it('combina cambios compatibles y señala conflictos y versiones obsoletas', () => {
    const first = proposal('first', { title: 'Nuevo título' });
    const second = proposal('second', { description: 'Después' });
    const conflict = proposal('conflict', { title: 'Otro título' });
    const stale = { ...proposal('stale', { solution: 'Tarde' }), expectedVersion: 2 };
    const preview = batchPreview([first, second, conflict, stale], [task]);
    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0].changes).toEqual([
      { field: 'title', before: 'Tarea', after: 'Nuevo título' },
      { field: 'description', before: 'Antes', after: 'Después' },
    ]);
    expect(preview.conflicts.get(conflict.id)).toContain('campo title');
    expect(preview.conflicts.get(stale.id)).toContain('versión actual es 3');
    expect(preview.groups[0].kind).toBe('task');
  });

  it('compara por palabras solo los campos de texto libre', () => {
    expect(isTextChange({ field: 'description', before: 'Antes', after: 'Después' })).toBe(true);
    expect(isTextChange({ field: 'due', before: '2027-01-01', after: '2027-01-02' })).toBe(false);
    expect(isTextChange({ field: 'state', before: 'Por hacer', after: 'En curso' })).toBe(false);
    expect(isTextChange({ field: 'dependencyIds', before: ['a'], after: ['a', 'b'] })).toBe(false);
    expect(isTextChange({ field: 'title', after: 'Nueva' })).toBe(false);
  });

  it('resume adjuntos sin incluir su contenido ni Base64', () => {
    const summary = attachmentSummary([
      { name: 'nota.md', mime: 'text/markdown', size: 12, data: 'U0VDUkVUTw==' },
    ]);
    expect(summary).toBe('nota.md · text/markdown · 12 bytes');
    expect(summary).not.toContain('U0VDUkVUTw');
    expect(
      proposalChanges({
        ...proposal(
          'create',
          { title: 'Nueva', attachments: [{ name: 'nota.md', data: 'U0VDUkVUTw==' }] },
          'create',
        ),
        targetId: undefined,
      }),
    ).toHaveLength(2);
  });
});
