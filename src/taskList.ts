import { PHASES, PRIORITIES, STATES, type Task } from '../shared/model';

export type TaskSortField = 'title' | 'due' | 'priority' | 'state' | 'phase';
export type TaskSortDirection = 'asc' | 'desc';
export interface TaskSortRule {
  field: TaskSortField;
  direction: TaskSortDirection;
}

export const TASK_SORT_FIELDS: { field: TaskSortField; label: string }[] = [
  { field: 'title', label: 'Título' },
  { field: 'state', label: 'Estado' },
  { field: 'priority', label: 'Prioridad' },
  { field: 'phase', label: 'Fase' },
  { field: 'due', label: 'Fecha' },
];

function compareField(a: Task, b: Task, field: TaskSortField): number {
  if (field === 'priority') return PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority);
  if (field === 'state') return STATES.indexOf(a.state) - STATES.indexOf(b.state);
  if (field === 'phase') {
    const aIndex = PHASES.findIndex((phase) => phase === a.phase);
    const bIndex = PHASES.findIndex((phase) => phase === b.phase);
    if (aIndex !== bIndex) {
      if (aIndex < 0) return 1;
      if (bIndex < 0) return -1;
      return aIndex - bIndex;
    }
  }
  return a[field].localeCompare(b[field], 'es', { sensitivity: 'base', numeric: true });
}

export function sortListTasks(tasks: Task[], rules: TaskSortRule[]): Task[] {
  return [...tasks].sort((a, b) => {
    for (const rule of rules) {
      const comparison = compareField(a, b, rule.field);
      if (comparison) return rule.direction === 'asc' ? comparison : -comparison;
    }
    return a.id.localeCompare(b.id);
  });
}
