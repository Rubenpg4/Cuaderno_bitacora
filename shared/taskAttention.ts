import { addDays } from './recurrence.js';
import type { Task } from './model.js';

export function nextRecurringTasks(tasks: Task[]): Task[] {
  const nextBySeries = new Map<string, Task>();
  for (const task of tasks) {
    const recurrence = task.recurrence;
    if (!recurrence || recurrence.canceledAt || task.state === 'Completada') continue;
    const previous = nextBySeries.get(recurrence.seriesId);
    if (
      !previous ||
      task.due.localeCompare(previous.due) < 0 ||
      (task.due === previous.due &&
        recurrence.occurrenceDate.localeCompare(previous.recurrence!.occurrenceDate) < 0)
    ) {
      nextBySeries.set(recurrence.seriesId, task);
    }
  }
  return tasks.filter(
    (task) => !task.recurrence || nextBySeries.get(task.recurrence.seriesId)?.id === task.id,
  );
}

export function taskAttention(task: Task, tasksById: Map<string, Task>, today: string) {
  const pendingDependencies = task.dependencyIds
    .map((id) => tasksById.get(id))
    .filter((dependency): dependency is Task =>
      Boolean(dependency && dependency.state !== 'Completada'),
    );
  return {
    pendingDependencies,
    dueSoon: task.due <= addDays(today, 6),
    overdue: task.due < today,
    missingStep: !task.nextStep.trim(),
    declaredBlock: Boolean(task.blocked.trim()),
  };
}
