import { addDays } from '../shared/recurrence';
import type { Task } from '../shared/model';
import { nextRecurringTasks } from './taskFilters';
import { taskAttention } from '../shared/taskAttention';

export type ReviewGroup = 'Atender' | 'Desbloquear' | 'Planificar';

export interface ReviewTask {
  task: Task;
  group: ReviewGroup;
  pendingDependencies: Task[];
  signals: string[];
}

const priorityOrder: Record<Task['priority'], number> = {
  Crítica: 0,
  'Muy alta': 1,
  Alta: 2,
  Media: 3,
  Baja: 4,
  'Muy baja': 5,
};

export function weeklyReview(tasks: Task[], projectId: string, today: string): ReviewTask[] {
  const projectTasks = tasks.filter(
    (task) => task.project === projectId && !task.recurrence?.canceledAt,
  );
  const byId = new Map(projectTasks.map((task) => [task.id, task]));
  return nextRecurringTasks(projectTasks)
    .filter((task) => task.state !== 'Completada')
    .flatMap((task): ReviewTask[] => {
      const { pendingDependencies, dueSoon, overdue, missingStep, declaredBlock } = taskAttention(
        task,
        byId,
        today,
      );
      const blocked = declaredBlock || pendingDependencies.length > 0;
      const inReview = task.state === 'En revisión';
      if (!blocked && !dueSoon && !inReview && !missingStep) return [];

      const signals = [
        ...(overdue ? ['Vencida'] : dueSoon ? ['Esta semana'] : []),
        ...(inReview ? ['En revisión'] : []),
        ...(declaredBlock ? ['Bloqueo declarado'] : []),
        ...(pendingDependencies.length ? ['Dependencias pendientes'] : []),
        ...(missingStep ? ['Sin siguiente paso'] : []),
      ];
      return [
        {
          task,
          group: blocked ? 'Desbloquear' : dueSoon || inReview ? 'Atender' : 'Planificar',
          pendingDependencies,
          signals,
        },
      ];
    })
    .sort((left, right) => {
      const due = left.task.due.localeCompare(right.task.due);
      if (due) return due;
      const priority = priorityOrder[left.task.priority] - priorityOrder[right.task.priority];
      if (priority) return priority;
      const title = left.task.title.localeCompare(right.task.title, 'es');
      return title || left.task.id.localeCompare(right.task.id);
    });
}

export function weeklyLoad(tasks: Task[], projectId: string, today: string) {
  const open = tasks.filter(
    (task) =>
      task.project === projectId && task.state !== 'Completada' && !task.recurrence?.canceledAt,
  );
  return Array.from({ length: 7 }, (_, offset) => {
    const day = addDays(today, offset);
    return { day, count: open.filter((task) => task.due === day).length };
  });
}
