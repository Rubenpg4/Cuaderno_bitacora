import { addDays } from './recurrence.js';
import { nextRecurringTasks } from './taskAttention.js';
import type {
  Entry,
  Objective,
  RecordItem,
  Task,
  WeeklyReviewBaseline,
  WeeklyReviewState,
} from './model.js';

export interface WeeklySignal {
  kind: 'agreement' | 'evidence' | 'stagnant';
  key: string;
  cause: string;
  recordId: string;
  itemId?: string;
  title: string;
  explanation: string;
}

const stateProgress: Record<Task['state'], number> = {
  'Por hacer': 0,
  'En curso': 1,
  'En revisión': 2,
  Completada: 3,
};

export function captureWeeklyBaseline(
  records: RecordItem[],
  projectId: string,
  at: string,
  day: string,
): WeeklyReviewBaseline {
  const scoped = records.filter(
    (record) => record.project === projectId || record.id === projectId,
  );
  const entries = scoped.filter((record): record is Entry => record.kind === 'entry');
  const resultsByTask = new Map<string, string[]>();
  for (const entry of entries) {
    if (!entry.result.trim()) continue;
    for (const taskId of entry.taskIds)
      resultsByTask.set(taskId, [...(resultsByTask.get(taskId) ?? []), entry.id]);
  }
  return {
    at,
    day,
    recordIds: scoped.map((record) => record.id),
    tasks: scoped
      .filter(
        (record): record is Task =>
          record.kind === 'task' && record.state !== 'Completada' && !record.recurrence?.canceledAt,
      )
      .map((task) => ({
        id: task.id,
        state: task.state,
        completedAt: task.completedAt,
        resultEntryIds: resultsByTask.get(task.id) ?? [],
      })),
  };
}

export function weeklySignals(
  records: RecordItem[],
  projectId: string,
  review: WeeklyReviewState | undefined,
  today: string,
): WeeklySignal[] {
  const scoped = records.filter(
    (record) => record.project === projectId || record.id === projectId,
  );
  const byId = new Map(scoped.map((record) => [record.id, record]));
  const baseline = review?.baseline;
  const seen = new Set(baseline?.recordIds ?? []);
  const entries = scoped.filter((record): record is Entry => record.kind === 'entry');
  const objectives = scoped.filter((record): record is Objective => record.kind === 'objective');
  const resultLinkedEntryIds = new Set<string>();
  const evidenceLinkedEntryIds = new Set<string>();
  for (const objective of objectives)
    for (const link of objective.links) {
      if (link.sourceKind !== 'entry') continue;
      if (link.role === 'resultado') resultLinkedEntryIds.add(link.sourceId);
      if (link.role === 'evidencia' && link.reference.trim())
        evidenceLinkedEntryIds.add(link.sourceId);
    }
  const signals: WeeklySignal[] = [];
  for (const meeting of scoped) {
    if (meeting.kind !== 'meeting' || !meeting.closedAt) continue;
    for (const agreement of meeting.agreementItems ?? []) {
      const linked = agreement.followUpTaskId ? byId.get(agreement.followUpTaskId) : undefined;
      if (
        !agreement.requiresFollowUp ||
        (linked?.kind === 'task' && !linked.recurrence?.canceledAt)
      )
        continue;
      signals.push({
        kind: 'agreement',
        key: `agreement:${meeting.id}:${agreement.id}`,
        cause: JSON.stringify([agreement.text.trim(), agreement.followUpTaskId ?? '']),
        recordId: meeting.id,
        itemId: agreement.id,
        title: agreement.text,
        explanation: 'Este acuerdo de la reunión no tiene tarea de seguimiento.',
      });
    }
  }

  if (baseline) {
    const newResultTaskIds = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.id) || entry.createdAt <= baseline.at || !entry.result.trim()) continue;
      for (const taskId of entry.taskIds) newResultTaskIds.add(taskId);
      const resultLink = resultLinkedEntryIds.has(entry.id);
      if (entry.contribution !== 'Validé' && !resultLink) continue;
      if (entry.evidence.trim() || evidenceLinkedEntryIds.has(entry.id)) continue;
      signals.push({
        kind: 'evidence',
        key: `evidence:${entry.id}:${entry.id}`,
        cause: JSON.stringify([entry.result.trim(), entry.contribution, resultLink]),
        recordId: entry.id,
        title: entry.title,
        explanation: 'Este resultado no tiene referencia de evidencia en su entrada.',
      });
    }

    if (addDays(baseline.day, 7) <= today) {
      const priorTasks = new Map(baseline.tasks.map((task) => [task.id, task]));
      const open = scoped.filter(
        (record): record is Task =>
          record.kind === 'task' && record.state !== 'Completada' && !record.recurrence?.canceledAt,
      );
      for (const task of nextRecurringTasks(open)) {
        const previous = priorTasks.get(task.id);
        if (!previous || stateProgress[task.state] > stateProgress[previous.state]) continue;
        if (newResultTaskIds.has(task.id)) continue;
        signals.push({
          kind: 'stagnant',
          key: `stagnant:${task.id}:${task.id}`,
          cause: JSON.stringify([baseline.at, previous.state, task.state]),
          recordId: task.id,
          title: task.title,
          explanation: `Sin avance acreditado desde la revisión del ${baseline.day}. Estado anterior: ${previous.state}; actual: ${task.state}.`,
        });
      }
    }
  }
  return signals;
}

export function visibleWeeklySignals(
  signals: WeeklySignal[],
  review: WeeklyReviewState | undefined,
  today: string,
): WeeklySignal[] {
  return signals.filter((signal) => {
    const decision = review?.decisions.find(
      (item) => item.key === signal.key && item.cause === signal.cause,
    );
    return (
      !decision || (decision.mode === 'postponed' && !!decision.until && decision.until <= today)
    );
  });
}
