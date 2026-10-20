import type { Task } from '../shared/model';
export { nextRecurringTasks } from '../shared/taskAttention';

export interface TaskFilters {
  type: string[];
  phase: string[];
  priority: string[];
  state: string[];
  tag: string[];
  blocked: string[];
  dueFrom: string;
  dueTo: string;
}

export const emptyTaskFilters: TaskFilters = {
  type: [],
  phase: [],
  priority: [],
  state: [],
  tag: [],
  blocked: [],
  dueFrom: '',
  dueTo: '',
};

export const TODAY_FILTERS_KEY = 'bitacora-filters-today';
export const BOARD_FILTERS_KEY = 'bitacora-filters-board';
export const LIST_FILTERS_KEY = 'bitacora-filters-list';
export type BoardDateScope = 'upcoming' | 'all' | 'range';

export function hasActiveFilters(filters: TaskFilters): boolean {
  return Object.values(filters).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  );
}

function savedSelection(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item))];
}

export function isOverdueTask(task: Task, today: string): boolean {
  return task.due < today && task.state !== 'Completada';
}

const PRIORITY_ORDER: Record<Task['priority'], number> = {
  Crítica: 6,
  'Muy alta': 5,
  Alta: 4,
  Media: 3,
  Baja: 2,
  'Muy baja': 1,
};

const SEQUENCE_PATTERN = /^\s*(\d+)\.(?:\s|$)/;

export function taskSequenceNumber(title: string): number | undefined {
  const match = SEQUENCE_PATTERN.exec(title);
  return match ? Number(match[1]) : undefined;
}

// Las tareas numeradas («1. Preparar script») siguen su número y van antes que las demás.
export function compareTaskSequence(a: Task, b: Task): number {
  const aSequence = taskSequenceNumber(a.title);
  const bSequence = taskSequenceNumber(b.title);
  if (aSequence === undefined || bSequence === undefined) {
    return Number(aSequence === undefined) - Number(bSequence === undefined);
  }
  return aSequence - bSequence;
}

export function compareBoardTasks(a: Task, b: Task): number {
  const dueComparison = (a.due || '').localeCompare(b.due || '');
  if (dueComparison !== 0) return dueComparison;

  const sequenceComparison = compareTaskSequence(a, b);
  if (sequenceComparison !== 0) return sequenceComparison;

  const priorityDiff = (PRIORITY_ORDER[b.priority] ?? 0) - (PRIORITY_ORDER[a.priority] ?? 0);
  if (priorityDiff !== 0) return priorityDiff;

  const aBlocked = Boolean(a.blocked && a.blocked.trim());
  const bBlocked = Boolean(b.blocked && b.blocked.trim());
  if (aBlocked !== bBlocked) {
    return aBlocked ? 1 : -1;
  }

  const createdComparison = (a.createdAt || '').localeCompare(b.createdAt || '');
  if (createdComparison !== 0) return createdComparison;

  const titleComparison = (a.title || '').localeCompare(b.title || '');
  if (titleComparison !== 0) return titleComparison;

  return (a.id || '').localeCompare(b.id || '');
}

export function filterBoardTasks(
  tasks: Task[],
  filters: TaskFilters,
  allTasks: Task[],
  today: string,
  dateScope: BoardDateScope,
): Task[] {
  const withoutDates = { ...filters, dueFrom: '', dueTo: '' };
  const matching = filterTasks(tasks, dateScope === 'range' ? filters : withoutDates, allTasks);
  if (dateScope !== 'upcoming') return matching;
  return matching.filter((task) => task.due >= today || isOverdueTask(task, today));
}

export function readSavedFilters(key: string, storage?: Storage): TaskFilters {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!target) return { ...emptyTaskFilters };
    const raw = target.getItem(key);
    if (!raw) return { ...emptyTaskFilters };
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return { ...emptyTaskFilters };
    return {
      type: savedSelection(data.type),
      phase: savedSelection(data.phase),
      priority: savedSelection(data.priority),
      state: savedSelection(data.state),
      tag: savedSelection(data.tag),
      blocked: savedSelection(data.blocked),
      dueFrom: typeof data.dueFrom === 'string' ? data.dueFrom : '',
      dueTo: typeof data.dueTo === 'string' ? data.dueTo : '',
    };
  } catch {
    return { ...emptyTaskFilters };
  }
}

export function saveFilters(key: string, filters: TaskFilters, storage?: Storage): void {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!target) return;
    const hasActive = hasActiveFilters(filters);
    if (!hasActive) {
      target.removeItem(key);
    } else {
      target.setItem(key, JSON.stringify(filters));
    }
  } catch {
    // Si localStorage no está disponible, se conserva en memoria durante la sesión.
  }
}

export function filterTasks(tasks: Task[], filters: TaskFilters, allTasks: Task[]): Task[] {
  return tasks.filter((task) => {
    if (filters.type.length && !filters.type.includes(task.type)) return false;
    if (filters.phase.length && !filters.phase.includes(task.phase)) return false;
    if (filters.priority.length && !filters.priority.includes(task.priority)) return false;
    if (filters.state.length && !filters.state.includes(task.state)) return false;
    if (filters.tag.length && !filters.tag.some((tag) => task.tags.includes(tag))) return false;
    if (filters.blocked.length) {
      const matchesBlocked = filters.blocked.some((option) => {
        if (option === 'blocked') return !!task.blocked.trim();
        if (option === 'clear') return !task.blocked.trim();
        if (option === 'waiting')
          return task.dependencyIds.some((id) =>
            allTasks.some(
              (dependency) => dependency.id === id && dependency.state !== 'Completada',
            ),
          );
        return false;
      });
      if (!matchesBlocked) return false;
    }
    if (filters.dueFrom && task.due < filters.dueFrom) return false;
    if (filters.dueTo && task.due > filters.dueTo) return false;
    return true;
  });
}
