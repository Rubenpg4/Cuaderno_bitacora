import { addDays } from '../shared/recurrence';
import { isTaskCompletedOnDay, type Task } from '../shared/model';
import {
  compareBoardTasks,
  compareTaskSequence,
  nextRecurringTasks,
  taskSequenceNumber,
} from './taskFilters';

export const DEFAULT_DAILY_CAPACITY = 3;
const LATER_LIMIT = 12;

export interface PlannerTask {
  task: Task;
  signals: string[];
  // El reparto automático no mueve apariciones de una serie ni tareas pendientes de revisión.
  movable: boolean;
}

export interface PlannerDay {
  day: string;
  past: boolean;
  tasks: PlannerTask[];
  done: number;
}

export interface WeekPlan {
  start: string;
  end: string;
  days: PlannerDay[];
  overdue: PlannerTask[];
  later: PlannerTask[];
  laterTotal: number;
}

export interface PlannedMove {
  task: Task;
  from: string;
  to: string;
}

export function weekStart(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
  return addDays(day, 1 - weekday);
}

export function isWeekend(day: string): boolean {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function openProjectTasks(tasks: Task[], projectId: string) {
  return tasks.filter(
    (task) =>
      task.project === projectId && task.state !== 'Completada' && !task.recurrence?.canceledAt,
  );
}

// Las tareas numeradas («1. …», «2. …») del mismo proyecto y subproyecto forman una secuencia;
// las apariciones recurrentes no participan.
function sequenceOf(task: Task) {
  const number = task.recurrence ? undefined : taskSequenceNumber(task.title);
  return number === undefined
    ? undefined
    : { group: `${task.project}/${task.subprojectId ?? ''}`, number };
}

// Una tarea numerada no puede quedar antes que un número menor ni después que uno mayor.
// `dueOf` puede omitir una tarea (undefined) cuya fecha todavía no cuenta como referencia.
function keepsSequence(
  task: Task,
  day: string,
  open: Task[],
  dueOf: (task: Task) => string | undefined,
) {
  const own = sequenceOf(task);
  if (!own) return true;
  return open.every((other) => {
    const theirs = other.id === task.id ? undefined : sequenceOf(other);
    if (!theirs || theirs.group !== own.group || theirs.number === own.number) return true;
    const otherDue = dueOf(other);
    if (otherDue === undefined) return true;
    return theirs.number < own.number ? otherDue <= day : otherDue >= day;
  });
}

function plannerTask(task: Task, byId: Map<string, Task>, open: Task[]): PlannerTask {
  const waiting = task.dependencyIds.some((id) => {
    const dependency = byId.get(id);
    return dependency && dependency.state !== 'Completada';
  });
  return {
    task,
    signals: [
      ...(task.state === 'En revisión' ? ['En revisión'] : []),
      ...(task.blocked.trim() ? ['Bloqueada'] : []),
      ...(waiting ? ['Espera tareas previas'] : []),
      ...(keepsSequence(task, task.due, open, ({ due }) => due) ? [] : ['Fuera de secuencia']),
      ...(task.recurrence ? ['Recurrente'] : []),
    ],
    movable: !task.recurrence && task.state !== 'En revisión',
  };
}

// Los días ya pasados de la semana no reciben tareas: lo abierto antes de hoy queda en «atrasadas».
export function weekPlan(tasks: Task[], projectId: string, today: string, start: string): WeekPlan {
  const projectTasks = tasks.filter(
    (task) => task.project === projectId && !task.recurrence?.canceledAt,
  );
  const byId = new Map(projectTasks.map((task) => [task.id, task]));
  const open = openProjectTasks(tasks, projectId).sort(compareBoardTasks);
  const end = addDays(start, 6);
  const toItem = (task: Task) => plannerTask(task, byId, open);
  const later = nextRecurringTasks(open).filter((task) => task.due > end && task.due >= today);
  return {
    start,
    end,
    days: Array.from({ length: 7 }, (_, offset) => {
      const day = addDays(start, offset);
      const past = day < today;
      return {
        day,
        past,
        tasks: past ? [] : open.filter((task) => task.due === day).map(toItem),
        done: projectTasks.filter((task) => isTaskCompletedOnDay(task, day)).length,
      };
    }),
    overdue: open.filter((task) => task.due < today).map(toItem),
    later: later.slice(0, LATER_LIMIT).map(toItem),
    laterTotal: later.length,
  };
}

/**
 * Propone movimientos para que ningún día supere la capacidad: primero coloca las atrasadas en
 * el primer hueco desde hoy y después desplaza las tareas de menor prioridad de los días
 * sobrecargados al día libre más cercano, sin adelantar una tarea a sus dependencias abiertas ni
 * retrasarla más allá de las tareas que esperan por ella, y conservando el orden de las tareas
 * numeradas de una misma secuencia.
 */
export function balanceWeek(
  tasks: Task[],
  projectId: string,
  today: string,
  start: string,
  options: { capacity: number; includeWeekend: boolean },
): PlannedMove[] {
  const plan = weekPlan(tasks, projectId, today, start);
  const capacity = Math.max(1, Math.floor(options.capacity));
  const targets = plan.days
    .filter(({ day, past }) => !past && (options.includeWeekend || !isWeekend(day)))
    .map(({ day }) => day);
  if (!targets.length) return [];

  const open = openProjectTasks(tasks, projectId);
  const due = new Map(open.map((task) => [task.id, task.due]));
  const load = new Map(plan.days.map(({ day, tasks }) => [day, tasks.length]));
  const moves: PlannedMove[] = [];

  // Las atrasadas aún sin colocar no fijan límites: se recolocan después en su propio orden.
  const scheduled = (id: string) => {
    const day = due.get(id);
    return day && day >= today ? day : undefined;
  };
  const fits = (task: Task, day: string) =>
    (load.get(day) ?? 0) < capacity &&
    task.dependencyIds.every((id) => (due.get(id) ?? day) <= day) &&
    open.every(
      (other) => !other.dependencyIds.includes(task.id) || (scheduled(other.id) ?? day) >= day,
    ) &&
    keepsSequence(task, day, open, (other) => scheduled(other.id));

  const place = (task: Task, candidates: string[]) => {
    const to = candidates.find((day) => fits(task, day));
    if (!to) return;
    if (task.due >= today && load.has(task.due)) load.set(task.due, load.get(task.due)! - 1);
    load.set(to, (load.get(to) ?? 0) + 1);
    due.set(task.id, to);
    moves.push({ task, from: task.due, to });
  };

  if (today >= plan.start && today <= plan.end) {
    // Las atrasadas numeradas se colocan en su orden para que «1.» ocupe el primer hueco.
    const overdue = [...plan.overdue].sort((a, b) => compareTaskSequence(a.task, b.task));
    for (const item of overdue) if (item.movable) place(item.task, targets);
  }

  for (const { day, past, tasks: dayTasks } of plan.days) {
    if (past) continue;
    const candidates = [
      ...targets.filter((target) => target > day),
      ...targets.filter((target) => target < day).reverse(),
    ];
    for (const item of [...dayTasks].reverse()) {
      if ((load.get(day) ?? 0) <= capacity) break;
      if (item.movable) place(item.task, candidates);
    }
  }
  return moves;
}
