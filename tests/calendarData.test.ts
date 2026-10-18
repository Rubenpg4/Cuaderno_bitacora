import { describe, expect, it } from 'vitest';
import type { Incident, Task } from '../shared/model';
import { buildCalendarData } from '../src/app/calendarData';

const task: Task = {
  id: 'task-1',
  kind: 'task',
  version: 1,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-12T10:00:00.000Z',
  title: 'Tarea',
  project: 'project-1',
  phase: 'Validación',
  type: 'General',
  tags: [],
  priority: 'Media',
  state: 'Completada',
  due: '2026-09-10',
  blocked: '',
  nextStep: '',
  description: '',
  solution: '',
  dependencyIds: [],
  checks: [],
  completedAt: '2026-09-12',
};

const incident: Incident = {
  id: 'incident-1',
  kind: 'incident',
  version: 1,
  createdAt: '2026-09-10T10:00:00.000Z',
  updatedAt: '2026-09-13T10:00:00.000Z',
  title: 'Incidencia',
  project: 'project-1',
  date: '2026-09-10',
  description: '',
  solution: 'Resuelta',
  resolvedDate: '2026-09-13',
};

describe('buildCalendarData', () => {
  it('agrupa tareas e incidencias en sus fechas de inicio y finalización', () => {
    const calendar = buildCalendarData({
      visibleTasks: [task],
      allTasks: [task],
      entries: [],
      allIncidents: [incident],
      scopedIncidents: [incident],
      scopedDecisions: [],
      scopedIdeas: [],
    });

    expect(calendar.tasksByDay.get('2026-09-10')).toEqual([task]);
    expect(calendar.tasksByDay.get('2026-09-12')).toEqual([task]);
    expect(calendar.incidentsByDay.get('2026-09-10')).toEqual([incident]);
    expect(calendar.incidentsByDay.get('2026-09-13')).toEqual([incident]);
    expect(calendar.markedDays).toEqual(new Set(['2026-09-10', '2026-09-12', '2026-09-13']));
  });

  it('mantiene marcas globales aunque los filtros oculten tarjetas', () => {
    const calendar = buildCalendarData({
      visibleTasks: [],
      allTasks: [task],
      entries: [],
      allIncidents: [incident],
      scopedIncidents: [],
      scopedDecisions: [],
      scopedIdeas: [],
    });

    expect(calendar.tasksByDay.size).toBe(0);
    expect(calendar.incidentsByDay.size).toBe(0);
    expect(calendar.markedDays.has('2026-09-12')).toBe(true);
    expect(calendar.markedDays.has('2026-09-13')).toBe(true);
  });
});
