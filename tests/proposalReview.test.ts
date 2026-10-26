import { describe, expect, it } from 'vitest';
import type { Entry, Proposal, RecordItem, Task } from '../shared/model';
import { failedProposals, planProposalReview } from '../shared/proposalReview';

const task = { id: 'task-1', kind: 'task', title: 'Tarea', version: 3 } as Task;
const reviewing = { id: 'task-2', kind: 'task', title: 'En revisión', version: 5 } as Task;
const entry = { id: 'entry-1', kind: 'entry', title: 'Entrada', version: 2 } as Entry;
const records: RecordItem[] = [task, reviewing, entry];

function proposal(id: string, overrides: Partial<Proposal> = {}): Proposal {
  return {
    id,
    operation: 'update',
    kind: 'task',
    targetId: task.id,
    expectedVersion: task.version,
    provider: 'codex',
    patch: { description: id },
    rationale: '',
    status: 'pending',
    createdAt: '',
    ...overrides,
  };
}

const failedIds = (proposals: Proposal[]) =>
  failedProposals(proposals, records).map(({ proposal }) => proposal.id);

describe('propuestas con fallo', () => {
  it('detecta registro eliminado, versión cambiada y tipo distinto con su motivo', () => {
    const failed = failedProposals(
      [
        proposal('eliminado', { targetId: 'missing' }),
        proposal('versión', { expectedVersion: 2 }),
        proposal('tipo', { kind: 'idea', targetId: entry.id, expectedVersion: entry.version }),
        proposal('eliminación', { operation: 'delete', targetId: 'missing', patch: {} }),
      ],
      records,
    );
    expect(failed.map(({ proposal, reason }) => [proposal.id, reason])).toEqual([
      ['eliminado', 'El registro ya no existe.'],
      ['versión', 'El registro cambió: la versión actual es 3 y la propuesta esperaba 2.'],
      ['tipo', 'El tipo del registro ya no coincide.'],
      ['eliminación', 'El registro ya no existe.'],
    ]);
  });

  it('excluye conflictos que solo existen dentro del lote', () => {
    const pending = [
      proposal('primera', { patch: { title: 'Uno' } }),
      proposal('segunda', { patch: { title: 'Dos' } }),
    ];
    expect(planProposalReview(pending, records).conflicts.size).toBe(1);
    expect(failedIds(pending)).toEqual([]);
  });

  it('excluye verificaciones agrupadas con el cierre que puso la tarea en revisión', () => {
    const closure = proposal('cierre', {
      targetId: reviewing.id,
      expectedVersion: reviewing.version,
      patch: { state: 'Completada' },
      previousTaskState: 'En curso',
    });
    const check = proposal('criterio', {
      operation: 'check',
      targetId: reviewing.id,
      expectedVersion: reviewing.version - 1,
      patch: { practiceId: 'practice-1', state: 'Cumplido', note: '' },
    });
    expect(failedIds([closure, check])).toEqual([]);
    // Without its pending closure the same check can no longer be accepted.
    expect(failedIds([check])).toEqual(['criterio']);
    expect(failedIds([{ ...closure, status: 'rejected' }, check])).toEqual(['criterio']);
  });

  it('excluye creaciones y propuestas ya revisadas', () => {
    expect(
      failedIds([
        proposal('creación', { operation: 'create', targetId: undefined }),
        proposal('rechazada', { targetId: 'missing', status: 'rejected' }),
        proposal('aceptada', { expectedVersion: 1, status: 'accepted' }),
      ]),
    ).toEqual([]);
  });

  it('coincide con los motivos de la aceptación en lote', () => {
    const stale = proposal('versión', { expectedVersion: 1 });
    expect(planProposalReview([stale], records).conflicts.get(stale.id)).toBe(
      failedProposals([stale], records)[0].reason,
    );
  });
});
