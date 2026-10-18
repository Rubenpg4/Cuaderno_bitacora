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

export function planProposalReview(proposals: Proposal[], records: RecordItem[]) {
  const ordered = [...proposals].sort((a, b) => {
    const rank = (p: Proposal) =>
      p.operation === 'check' ? 0 : p.patch.state === 'Completada' ? 2 : 1;
    return rank(a) - rank(b);
  });
  const accepted: Proposal[] = [];
  const conflicts = new Map<string, string>();
  const fields = new Map<string, Map<string, unknown>>();
  const ids = new Set<string>();
  const rebasedChecks = new Set<string>();
  const reviewingClosures = new Set(
    proposals
      .filter((p) => p.previousTaskState !== undefined && p.patch.state === 'Completada')
      .map((p) => p.targetId),
  );

  for (const proposal of ordered) {
    if (ids.has(proposal.id)) {
      conflicts.set(proposal.id, 'La propuesta está repetida en el lote.');
      continue;
    }
    ids.add(proposal.id);
    const record = proposal.targetId ? records.find((r) => r.id === proposal.targetId) : undefined;
    const versionMatches =
      record?.version === proposal.expectedVersion ||
      (proposal.operation === 'check' &&
        reviewingClosures.has(proposal.targetId) &&
        record?.version === (proposal.expectedVersion ?? 0) + 1);
    if (
      proposal.operation !== 'create' &&
      (!record || record.kind !== proposal.kind || !versionMatches)
    ) {
      conflicts.set(
        proposal.id,
        !record
          ? 'El registro ya no existe.'
          : record.kind !== proposal.kind
            ? 'El tipo del registro ya no coincide.'
            : `El registro cambió: la versión actual es ${record.version} y la propuesta esperaba ${proposal.expectedVersion}.`,
      );
      continue;
    }
    const targetFields = proposal.targetId
      ? (fields.get(proposal.targetId) ?? new Map<string, unknown>())
      : undefined;
    const changes =
      proposal.operation === 'check'
        ? ([[`checks:${String(proposal.patch.practiceId)}`, proposal.patch]] as const)
        : Object.entries(proposal.patch);
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
