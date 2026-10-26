import { addDays } from '../shared/recurrence';
import { isTaskCompletedOnDay, type Task } from '../shared/model';
import { compareBoardTasks, nextRecurringTasks, taskSequenceNumber } from './taskFilters';

export const DEFAULT_DAILY_CAPACITY = 3;
const LATER_LIMIT = 12;
// Semanas siguientes por las que se reparte lo que no cabe en la semana planificada.
const OVERFLOW_WEEKS = 8;

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

export interface WeekBalance {
  moves: PlannedMove[];
  // Tareas que no se pueden recolocar sin romper una dependencia o la secuencia.
  unplaced: Task[];
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
function keepsSequence(task: Task, open: Task[]) {
  const own = sequenceOf(task);
  if (!own) return true;
  return open.every((other) => {
    const theirs = other.id === task.id ? undefined : sequenceOf(other);
    if (!theirs || theirs.group !== own.group || theirs.number === own.number) return true;
    return theirs.number < own.number ? other.due <= task.due : other.due >= task.due;
  });
}

// `before` debe hacerse el mismo día o antes que `after`: es una dependencia suya o un paso
// anterior de la misma secuencia.
function mustPrecede(before: Task, after: Task) {
  if (after.dependencyIds.includes(before.id)) return true;
  const first = sequenceOf(before);
  const second = sequenceOf(after);
  return Boolean(first && second && first.group === second.group && first.number < second.number);
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
      ...(keepsSequence(task, open) ? [] : ['Fuera de secuencia']),
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
 * Recoloca de una vez todas las tareas movibles de la semana —desde hoy, con las atrasadas si es
 * la semana actual— llenando cada día hasta la capacidad en orden: primero lo atrasado y lo más
 * próximo, los pasos numerados de una secuencia por su número y cada tarea después de sus
 * dependencias abiertas. Las apariciones de series y las tareas «En revisión» se quedan en su día
 * y ocupan capacidad. Lo que no cabe se reparte por las semanas siguientes, contando lo que ya
 * tienen; lo que no se puede colocar sin romper una dependencia o la secuencia se queda donde está.
 */
export function balanceWeek(
  tasks: Task[],
  projectId: string,
  today: string,
  start: string,
  options: { capacity: number; includeWeekend: boolean },
): WeekBalance {
  const capacity = Math.max(1, Math.floor(options.capacity));
  const end = addDays(start, 6);
  const first = start > today ? start : today;
  if (first > end) return { moves: [], unplaced: [] };
  const days = Array.from({ length: 7 * (OVERFLOW_WEEKS + 1) }, (_, offset) =>
    addDays(start, offset),
  ).filter((day) => day >= first && (options.includeWeekend || !isWeekend(day)));

  const open = openProjectTasks(tasks, projectId);
  const movable = (task: Task) => !task.recurrence && task.state !== 'En revisión';
  const planned = open.filter(
    (task) => movable(task) && task.due <= end && (task.due >= first || today >= start),
  );
  // Un paso previsto para más adelante se trae a la semana si hay en ella un paso posterior.
  const lastStep = new Map<string, number>();
  for (const task of planned) {
    const step = sequenceOf(task);
    if (step) lastStep.set(step.group, Math.max(lastStep.get(step.group) ?? 0, step.number));
  }
  for (const task of open) {
    const step = sequenceOf(task);
    if (task.due > end && movable(task) && step && step.number < (lastStep.get(step.group) ?? 0))
      planned.push(task);
  }

  const ids = new Set(planned.map(({ id }) => id));
  const load = new Map<string, number>();
  const occupy = (day: string) => load.set(day, (load.get(day) ?? 0) + 1);
  for (const task of open) if (!ids.has(task.id)) occupy(task.due);

  // Un paso previo hereda la fecha más temprana de lo que espera por él para no quedarse atrás.
  const urgency = new Map(planned.map((task) => [task.id, task.due]));
  for (let round = 0, changed = true; changed && round < planned.length; round++) {
    changed = false;
    for (const before of planned) {
      for (const after of planned) {
        if (before === after || !mustPrecede(before, after)) continue;
        if (urgency.get(after.id)! < urgency.get(before.id)!) {
          urgency.set(before.id, urgency.get(after.id)!);
          changed = true;
        }
      }
    }
  }
  const byUrgency = (a: Task, b: Task) =>
    urgency.get(a.id)!.localeCompare(urgency.get(b.id)!) || compareBoardTasks(a, b);

  const due = new Map(open.map((task) => [task.id, task.due]));
  const remaining = [...planned];
  const moves: PlannedMove[] = [];
  const unplaced: Task[] = [];
  while (remaining.length) {
    const ready = remaining.filter((task) =>
      remaining.every((other) => other === task || !mustPrecede(other, task)),
    );
    // Con un ciclo de dependencias no hay ninguna lista: se rompe por el orden habitual.
    const task = (ready.length ? ready : remaining).sort(byUrgency)[0];
    remaining.splice(remaining.indexOf(task), 1);

    let earliest = first;
    let latest: string | undefined;
    for (const other of open) {
      if (other === task) continue;
      if (mustPrecede(other, task) && !remaining.includes(other) && due.get(other.id)! > earliest)
        earliest = due.get(other.id)!;
      if (mustPrecede(task, other) && !ids.has(other.id) && (!latest || other.due < latest))
        latest = other.due;
    }
    const to = days.find(
      (day) => day >= earliest && (!latest || day <= latest) && (load.get(day) ?? 0) < capacity,
    );
    if (!to) {
      unplaced.push(task);
      occupy(task.due);
      continue;
    }
    occupy(to);
    due.set(task.id, to);
    if (to !== task.due) moves.push({ task, from: task.due, to });
  }
  return { moves, unplaced };
}
