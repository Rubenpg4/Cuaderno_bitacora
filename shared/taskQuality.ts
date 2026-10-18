import { applicable, unresolved, type Practice, type Proposal, type Task } from './model.js';
import { nextRecurringTasks, taskAttention } from './taskAttention.js';

export const TASK_QUALITY_CATEGORIES = [
  'sin_siguiente_paso',
  'dependencia_pendiente',
  'vencimiento',
  'criterio_obligatorio_pendiente',
  'cierre_pendiente',
] as const;
export type TaskQualityCategory = (typeof TASK_QUALITY_CATEGORIES)[number];

export interface TaskQualityItem {
  id: string;
  title: string;
  version: number;
  category: TaskQualityCategory;
  reason: string;
}

export function diagnoseTaskQuality(
  tasks: Task[],
  practices: Practice[],
  proposals: Proposal[],
  projectId: string,
  today: string,
) {
  const projectTasks = tasks.filter(
    (task) => task.project === projectId && !task.recurrence?.canceledAt,
  );
  const byId = new Map(projectTasks.map((task) => [task.id, task]));
  const activePractices = practices.filter(
    (practice) =>
      (!practice.project || practice.project === projectId) &&
      practice.status !== 'Borrador' &&
      practice.status !== 'Retirada',
  );
  const practicesById = new Map(activePractices.map((practice) => [practice.id, practice]));
  const pendingClosures = new Set(
    proposals
      .filter(
        (proposal) =>
          proposal.status === 'pending' &&
          proposal.kind === 'task' &&
          proposal.operation === 'update' &&
          proposal.patch.state === 'Completada',
      )
      .map((proposal) => proposal.targetId),
  );
  const counts = Object.fromEntries(
    TASK_QUALITY_CATEGORIES.map((category) => [category, 0]),
  ) as Record<TaskQualityCategory, number>;
  const items: TaskQualityItem[] = [];
  const open = nextRecurringTasks(projectTasks)
    .filter((task) => task.state !== 'Completada')
    .sort(
      (a, b) =>
        a.due.localeCompare(b.due) ||
        a.title.localeCompare(b.title, 'es') ||
        a.id.localeCompare(b.id),
    );

  for (const task of open) {
    const attention = taskAttention(task, byId, today);
    const pendingChecks = task.checks.filter((check) => {
      const practice = practicesById.get(check.practiceId);
      return (
        practice &&
        (check.mandatory || practice.mandatory) &&
        (unresolved(check) || practice.version !== check.practiceVersion)
      );
    }).length;
    const missingChecks = activePractices.filter(
      (practice) =>
        practice.mandatory &&
        applicable(practice, task) &&
        !task.checks.some((check) => check.practiceId === practice.id),
    ).length;
    const reasons: Partial<Record<TaskQualityCategory, string>> = {
      ...(attention.missingStep && { sin_siguiente_paso: 'No tiene siguiente paso.' }),
      ...(attention.pendingDependencies.length && {
        dependencia_pendiente: `Dependencias sin completar: ${attention.pendingDependencies.length}.`,
      }),
      ...(attention.dueSoon && {
        vencimiento: `${attention.overdue ? 'Vencida' : 'Vence'} el ${task.due}.`,
      }),
      ...(pendingChecks + missingChecks > 0 && {
        criterio_obligatorio_pendiente: `Criterios obligatorios pendientes: ${pendingChecks + missingChecks}.`,
      }),
      ...(pendingClosures.has(task.id) && { cierre_pendiente: 'Propuesta de cierre pendiente.' }),
    };
    for (const category of TASK_QUALITY_CATEGORIES) {
      const reason = reasons[category];
      if (!reason) continue;
      counts[category]++;
      items.push({ id: task.id, title: task.title, version: task.version, category, reason });
    }
  }
  return { counts, items };
}
