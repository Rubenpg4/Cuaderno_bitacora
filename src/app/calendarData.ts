import {
  isIncidentResolved,
  taskCompletionDay,
  type Decision,
  type Entry,
  type Idea,
  type Incident,
  type Task,
} from '../../shared/model';

interface CalendarDataInput {
  visibleTasks: Task[];
  allTasks: Task[];
  entries: Entry[];
  allIncidents: Incident[];
  scopedIncidents: Incident[];
  scopedDecisions: Decision[];
  scopedIdeas: Idea[];
}

function addOnDay<T>(itemsByDay: Map<string, T[]>, day: string, item: T) {
  const items = itemsByDay.get(day) || [];
  items.push(item);
  itemsByDay.set(day, items);
}

export function buildCalendarData({
  visibleTasks,
  allTasks,
  entries,
  allIncidents,
  scopedIncidents,
  scopedDecisions,
  scopedIdeas,
}: CalendarDataInput) {
  const tasksByDay = new Map<string, Task[]>();
  for (const task of visibleTasks) {
    addOnDay(tasksByDay, task.due, task);
    const completionDay = taskCompletionDay(task);
    if (completionDay && completionDay !== task.due) {
      addOnDay(tasksByDay, completionDay, task);
    }
  }

  const incidentsByDay = new Map<string, Incident[]>();
  for (const incident of scopedIncidents) {
    addOnDay(incidentsByDay, incident.date, incident);
    if (
      isIncidentResolved(incident) &&
      incident.resolvedDate &&
      incident.resolvedDate !== incident.date
    ) {
      addOnDay(incidentsByDay, incident.resolvedDate, incident);
    }
  }

  const decisionsByDay = new Map<string, Decision[]>();
  for (const decision of scopedDecisions) addOnDay(decisionsByDay, decision.date, decision);

  const ideasByDay = new Map<string, Idea[]>();
  for (const idea of scopedIdeas) addOnDay(ideasByDay, idea.date, idea);

  // La vista principal conserva las marcas globales; Hoy añade decisiones e ideas del ámbito actual.
  const markedDays = new Set([
    ...allTasks.map((task) => task.due),
    ...(allTasks.map((task) => taskCompletionDay(task)).filter(Boolean) as string[]),
    ...entries.map((entry) => entry.date),
    ...allIncidents.flatMap((incident) => [incident.date, incident.resolvedDate]).filter(Boolean),
  ]);
  const todayMarkedDays = new Set([
    ...markedDays,
    ...scopedDecisions.map((decision) => decision.date),
    ...scopedIdeas.map((idea) => idea.date),
  ]);

  return {
    tasksByDay,
    incidentsByDay,
    decisionsByDay,
    ideasByDay,
    markedDays,
    todayMarkedDays,
  };
}
