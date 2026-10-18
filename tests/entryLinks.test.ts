import { describe, expect, it } from 'vitest';
import {
  taskCompletionDay,
  isTaskCompletedOnDay,
  type RecordItem,
  type Task,
} from '../shared/model';
import { linksFromEntryText, resolveEntryMentions } from '../shared/entryLinks';

describe('vínculos de menciones en entradas', () => {
  it('reúne menciones de las respuestas, sin duplicados ni registros borrados', () => {
    const records = [
      { kind: 'task', id: 'tarea-1' },
      { kind: 'incident', id: 'incidencia-1' },
      { kind: 'decision', id: 'decision-1' },
      { kind: 'idea', id: 'idea-1' },
    ] as RecordItem[];
    expect(
      linksFromEntryText(
        {
          activity: 'Avancé con @[task:tarea-1] y @[incident:incidencia-1]',
          result: 'Terminé @[task:tarea-1] tras @[decision:decision-1]',
          learning: 'Surgió @[idea:idea-1] y vi @[incident:borrada]',
          blocker: '',
          nextStep: '',
        },
        records,
      ),
    ).toEqual({
      taskIds: ['tarea-1'],
      linkedIds: ['incidencia-1', 'decision-1', 'idea-1'],
    });
  });

  it('resuelve el nombre más largo y deja nombres ambiguos sin vínculo', () => {
    const records = [
      { kind: 'task', id: 'tarea-corta', title: 'Revisar' },
      { kind: 'task', id: 'tarea-larga', title: 'Revisar diseño' },
      { kind: 'idea', id: 'idea-1', title: 'Revisar' },
    ] as RecordItem[];
    const resolved = resolveEntryMentions(
      {
        activity: 'Hice @Revisar diseño y @Revisar. No @Revisar diseños.',
      },
      records,
    );
    expect(resolved.entry.activity).toBe(
      'Hice @[task:tarea-larga] y @Revisar. No @Revisar diseños.',
    );
    expect(resolved.taskIds).toEqual(['tarea-larga']);
    expect(resolved.linkedIds).toEqual([]);
  });

  it('determina correctamente el día de finalización efectiva de una tarea', () => {
    const incompleteTask = {
      kind: 'task',
      state: 'Por hacer',
      due: '2026-09-30',
    } as Task;
    expect(taskCompletionDay(incompleteTask)).toBeUndefined();
    expect(isTaskCompletedOnDay(incompleteTask, '2026-09-29')).toBe(false);

    const completedEarlyTask = {
      kind: 'task',
      state: 'Completada',
      due: '2026-09-30',
      completedAt: '2026-09-29T14:30:00.000Z',
    } as Task;
    expect(taskCompletionDay(completedEarlyTask)).toBe('2026-09-29');
    expect(isTaskCompletedOnDay(completedEarlyTask, '2026-09-29')).toBe(true);
    expect(isTaskCompletedOnDay(completedEarlyTask, '2026-09-30')).toBe(false);

    const legacyCompletedTask = {
      kind: 'task',
      state: 'Completada',
      due: '2026-09-28',
    } as Task;
    expect(taskCompletionDay(legacyCompletedTask)).toBe('2026-09-28');
    expect(isTaskCompletedOnDay(legacyCompletedTask, '2026-09-28')).toBe(true);
  });
});
