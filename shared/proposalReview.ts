import type { Proposal, RecordItem } from './model';

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameValue(v, b[i]))
    );
  const left = Object.keys(a as Record<string, unknown>);
  const right = Object.keys(b as Record<string, unknown>);
  return (
    left.length === right.length &&
    left.every(
      (key) =>
        key in (b as object) &&
        sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

export { sameValue as sameProposalValue };

export function taskCompletionReviewGroup(proposal: Proposal, pending: Proposal[]) {
  if (proposal.kind !== 'task' || !proposal.targetId) return [];
  const closure = pending.find(
    (candidate) =>
      candidate.status === 'pending' &&
      candidate.kind === 'task' &&
      candidate.operation === 'update' &&
      candidate.patch.state === 'Completada' &&
      candidate.previousTaskState !== undefined &&
      candidate.targetId === proposal.targetId &&
      candidate.provider === proposal.provider,
  );
  if (!closure || (proposal.id !== closure.id && proposal.operation !== 'check')) return [];
  const checks = pending.filter(
    (candidate) =>
      candidate.status === 'pending' &&
      candidate.kind === 'task' &&
      candidate.operation === 'check' &&
      candidate.targetId === closure.targetId &&
      candidate.provider === closure.provider,
  );
  return checks.length ? [closure, ...checks] : [];
}

/** Tasks that a closure in the list put «En revisión», which bumped their version once. */
function closureTargets(proposals: Proposal[]) {
  return new Set(
    proposals
      .filter((p) => p.previousTaskState !== undefined && p.patch.state === 'Completada')
      .map((p) => p.targetId),
  );
}

/** Why a proposal no longer fits its target record, regardless of the rest of the batch. */
function recordConflict(
  proposal: Proposal,
  records: RecordItem[],
  reviewingClosures: Set<string | undefined>,
) {
  if (proposal.operation === 'create') return undefined;
  const record = proposal.targetId ? records.find((r) => r.id === proposal.targetId) : undefined;
  if (!record) return 'El registro ya no existe.';
  if (record.kind !== proposal.kind) return 'El tipo del registro ya no coincide.';
  const versionMatches =
    record.version === proposal.expectedVersion ||
    (proposal.operation === 'check' &&
      reviewingClosures.has(proposal.targetId) &&
      record.version === (proposal.expectedVersion ?? 0) + 1);
  return versionMatches
    ? undefined
    : `El registro cambió: la versión actual es ${record.version} y la propuesta esperaba ${proposal.expectedVersion}.`;
}

/**
 * Pending proposals that can never be accepted because their target record was deleted,
 * changed kind or moved to another version. Conflicts that only exist inside a batch are
 * excluded: each of those proposals is still acceptable on its own.
 */
export function failedProposals(proposals: Proposal[], records: RecordItem[]) {
  const pending = proposals.filter((p) => p.status === 'pending');
  const reviewingClosures = closureTargets(pending);
  return pending.flatMap((proposal) => {
    const reason = recordConflict(proposal, records, reviewingClosures);
    return reason ? [{ proposal, reason }] : [];
  });
}

export function planProposalReview(proposals: Proposal[], records: RecordItem[]) {
  const ordered = [...proposals].sort((a, b) => {
    const rank = (p: Proposal) =>
      p.operation === 'check'
        ? 0
        : p.operation === 'delete'
          ? 3
          : p.patch.state === 'Completada'
            ? 2
            : 1;
    return rank(a) - rank(b);
  });
  const accepted: Proposal[] = [];
  const conflicts = new Map<string, string>();
  const fields = new Map<string, Map<string, unknown>>();
  const ids = new Set<string>();
  const rebasedChecks = new Set<string>();
  const deleted = new Set<string>();
  const reviewingClosures = closureTargets(proposals);

  for (const proposal of ordered) {
    if (ids.has(proposal.id)) {
      conflicts.set(proposal.id, 'La propuesta está repetida en el lote.');
      continue;
    }
    ids.add(proposal.id);
    const record = proposal.targetId ? records.find((r) => r.id === proposal.targetId) : undefined;
    const targetConflict = recordConflict(proposal, records, reviewingClosures);
    if (targetConflict) {
      conflicts.set(proposal.id, targetConflict);
      continue;
    }
    const targetFields = proposal.targetId
      ? (fields.get(proposal.targetId) ?? new Map<string, unknown>())
      : undefined;
    const changes =
      proposal.operation === 'check'
        ? ([[`checks:${String(proposal.patch.practiceId)}`, proposal.patch]] as const)
        : Object.entries(proposal.patch);
    // Deletions run last, so any earlier change to the same record would be lost.
    if (proposal.targetId && deleted.has(proposal.targetId)) {
      conflicts.set(proposal.id, 'Otra propuesta del lote ya elimina este registro.');
      continue;
    }
    if (proposal.operation === 'delete' && targetFields?.size) {
      conflicts.set(proposal.id, 'Otra propuesta del lote modifica el registro que se eliminaría.');
      continue;
    }
    const overlap = changes.find(
      ([key, value]) => targetFields?.has(key) && !sameValue(targetFields.get(key), value),
    );
    if (overlap) {
      conflicts.set(
        proposal.id,
        `Otra propuesta del lote cambia de forma incompatible el campo ${overlap[0]}.`,
      );
      continue;
    }
    accepted.push(proposal);
    if (proposal.operation === 'delete' && proposal.targetId) deleted.add(proposal.targetId);
    if (proposal.operation === 'check' && record?.version !== proposal.expectedVersion)
      rebasedChecks.add(proposal.id);
    if (targetFields && proposal.targetId) {
      for (const [key, value] of changes) targetFields.set(key, value);
      fields.set(proposal.targetId, targetFields);
    }
  }
  const acceptedClosures = new Set(
    accepted.filter((p) => p.previousTaskState !== undefined).map((p) => p.targetId),
  );
  for (const proposal of accepted) {
    if (rebasedChecks.has(proposal.id) && !acceptedClosures.has(proposal.targetId))
      conflicts.set(
        proposal.id,
        'La verificación requiere incluir el cierre que puso la tarea en revisión.',
      );
  }
  return { ordered: accepted.filter((p) => !conflicts.has(p.id)), conflicts };
}
