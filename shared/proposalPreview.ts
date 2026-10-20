import type { Proposal, RecordItem, Task } from './model';
import { planProposalReview, sameProposalValue } from './proposalReview';

export interface PreviewChange {
  field: string;
  before?: unknown;
  after: unknown;
}

const hiddenFields = new Set([
  'id',
  'version',
  'createdAt',
  'updatedAt',
  'checks',
  'completedAt',
  'recurrence',
  'closedAt',
  'sourceIds',
  'taskIds',
  'linkedIds',
  'validationDate',
  'validationReference',
  'tutor',
  'authorization',
  'exceptionReason',
]);

/** Free text worth comparing word by word; lists, dates and enumerations keep before/after. */
const textFields = new Set([
  'title',
  'body',
  'activity',
  'result',
  'learning',
  'note',
  'explanation',
  'description',
  'solution',
  'nextStep',
  'blocked',
  'blocker',
  'problem',
  'decision',
  'reason',
  'alternatives',
  'consequences',
  'agreements',
  'evidence',
  'objective',
  'specifications',
  'competency',
]);

export function isTextChange(change: PreviewChange) {
  return (
    textFields.has(change.field) &&
    typeof change.before === 'string' &&
    typeof change.after === 'string'
  );
}

function checkChange(proposal: Proposal, record?: RecordItem): PreviewChange[] {
  if (record?.kind !== 'task') return [];
  const current = (record as Task).checks.find(
    (check) => check.practiceId === proposal.patch.practiceId,
  );
  if (!current) return [];
  const proposed = { state: proposal.patch.state, note: proposal.patch.note };
  const before = { state: current.state, note: current.note };
  return sameProposalValue(before, proposed)
    ? []
    : [{ field: `check:${current.practiceId}`, before, after: proposed }];
}

/** The person sees the meeting sources a mention will add before accepting it. */
function meetingSourcesChange(proposal: Proposal, record?: RecordItem) {
  if (proposal.kind !== 'meeting' || !proposal.meetingSourceIds?.length) return undefined;
  const current = record?.kind === 'meeting' ? record.sourceIds : [];
  return [...new Set([...current, ...proposal.meetingSourceIds])];
}

export function proposalChanges(proposal: Proposal, record?: RecordItem): PreviewChange[] {
  if (proposal.operation === 'check') return checkChange(proposal, record);
  if (proposal.operation === 'delete')
    return [{ field: 'delete', before: record?.title ?? 'Registro', after: 'Se eliminará' }];
  const sources = meetingSourcesChange(proposal, record);
  return Object.entries(proposal.patch)
    .filter(([field]) => !hiddenFields.has(field))
    .concat(sources ? [['sourceIds', sources]] : [])
    .flatMap(([field, after]) => {
      const before =
        field === 'state' && proposal.previousTaskState
          ? proposal.previousTaskState
          : record
            ? (record as unknown as Record<string, unknown>)[field]
            : undefined;
      return proposal.operation !== 'create' && sameProposalValue(before, after)
        ? []
        : [{ field, before, after }];
    });
}

export function batchPreview(proposals: Proposal[], records: RecordItem[]) {
  const plan = planProposalReview(proposals, records);
  const groups = new Map<
    string,
    { title: string; kind: Proposal['kind']; changes: PreviewChange[] }
  >();
  for (const proposal of plan.ordered) {
    const record = records.find((item) => item.id === proposal.targetId);
    const key = proposal.targetId || proposal.id;
    const group = groups.get(key) || {
      title: String(proposal.patch.title || record?.title || 'Nuevo registro'),
      kind: proposal.kind,
      changes: [],
    };
    for (const change of proposalChanges(proposal, record)) {
      const index = group.changes.findIndex((item) => item.field === change.field);
      if (index >= 0) group.changes[index] = change;
      else group.changes.push(change);
    }
    groups.set(key, group);
  }
  return { ...plan, groups: [...groups.values()] };
}

export function attachmentSummary(value: unknown): string {
  if (!Array.isArray(value)) return 'Sin adjuntos';
  return (
    value
      .map((item) => {
        if (!item || typeof item !== 'object') return 'Adjunto';
        const attachment = item as Record<string, unknown>;
        const name = typeof attachment.name === 'string' ? attachment.name : 'Adjunto';
        const mime = typeof attachment.mime === 'string' ? attachment.mime : 'Tipo desconocido';
        const size = typeof attachment.size === 'number' ? attachment.size : 0;
        return `${name} · ${mime} · ${size} bytes`;
      })
      .join(', ') || 'Sin adjuntos'
  );
}
