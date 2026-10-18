import { describe, expect, it } from 'vitest';
import type { Entry, Meeting, RecordItem, Task, WeeklyReviewState } from '../shared/model';
import {
  captureWeeklyBaseline,
  visibleWeeklySignals,
  weeklySignals,
} from '../shared/weeklyReviewSignals';

const project = 'active';
const at = '2026-09-20T12:00:00.000Z';

function task(id: string, changes: Partial<Task> = {}): Task {
  return {
    id,
    kind: 'task',
    version: 1,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: at,
    title: id,
    project,
    phase: 'Implementación',
    type: '',
    tags: [],
    priority: 'Media',
    state: 'Por hacer',
    due: '2026-10-20',
    blocked: '',
    nextStep: 'Continuar',
    description: '',
    solution: '',
    dependencyIds: [],
    checks: [],
    ...changes,
  };
}

function entry(id: string, changes: Partial<Entry> = {}): Entry {
  return {
    id,
    kind: 'entry',
    version: 1,
    createdAt: '2026-09-22T12:00:00.000Z',
    updatedAt: '2026-09-22T12:00:00.000Z',
    title: id,
    project,
    date: '2026-09-22',
    taskIds: [],
    activity: '',
    result: 'Resultado comprobado',
    learning: '',
    nextStep: '',
    blocker: '',
    competency: '',
    evidence: '',
    original: '',
    contribution: 'Validé',
    ...changes,
  };
}

function review(records: RecordItem[]): WeeklyReviewState {
  return {
    version: 1,
    baseline: captureWeeklyBaseline(records, project, at, '2026-09-20'),
    decisions: [],
  };
}

describe('señales de revisión semanal', () => {
  it('solo señala acuerdos estructurados cerrados que piden seguimiento', () => {
    const meeting: Meeting = {
      id: 'meeting',
      kind: 'meeting',
      version: 1,
      createdAt: at,
      updatedAt: at,
      title: 'Reunión',
      project,
      from: at,
      to: '2026-09-20T13:00:00.000Z',
      body: '',
      agreements: 'Texto legado sin estructura',
      sourceIds: [],
      closedAt: at,
      agreementItems: [
        { id: 'pending', text: 'Revisar entregable', requiresFollowUp: true },
        { id: 'informal', text: 'Comentario', requiresFollowUp: false },
        { id: 'linked', text: 'Enviar informe', requiresFollowUp: true, followUpTaskId: 'task' },
      ],
    };
    expect(
      weeklySignals([meeting, task('task')], project, undefined, '2026-09-29').map((s) => s.key),
    ).toEqual(['agreement:meeting:pending']);
    expect(
      weeklySignals(
        [
          meeting,
          task('task', {
            recurrence: {
              seriesId: 'series',
              occurrenceDate: '2026-09-20',
              overriddenFields: [],
              canceledAt: at,
            },
          }),
        ],
        project,
        undefined,
        '2026-09-29',
      ).map((s) => s.key),
    ).toEqual(['agreement:meeting:pending', 'agreement:meeting:linked']);
    expect(
      weeklySignals([{ ...meeting, closedAt: undefined }], project, undefined, '2026-09-29'),
    ).toEqual([]);
  });

  it('no confunde ediciones con avance y espera siete días antes de señalar estancamiento', () => {
    const before = task('stagnant');
    const baseline = review([before]);
    const edited = { ...before, version: 2, due: '2026-11-01', nextStep: 'Texto nuevo' };
    expect(weeklySignals([edited], project, baseline, '2026-09-26')).toEqual([]);
    expect(weeklySignals([edited], project, baseline, '2026-09-27').map((s) => s.kind)).toEqual([
      'stagnant',
    ]);
    expect(
      weeklySignals([{ ...edited, state: 'En curso' }], project, baseline, '2026-09-27'),
    ).toEqual([]);
    expect(
      weeklySignals(
        [edited, entry('result', { taskIds: ['stagnant'] })],
        project,
        baseline,
        '2026-09-27',
      ).some((s) => s.kind === 'stagnant'),
    ).toBe(false);
    expect(
      weeklySignals(
        [edited, entry('old', { taskIds: ['stagnant'], createdAt: at })],
        project,
        baseline,
        '2026-09-27',
      ).some((s) => s.kind === 'stagnant'),
    ).toBe(true);
  });

  it('reclama evidencia solo para resultados nuevos y de la misma entrada', () => {
    const old = entry('old', { createdAt: '2026-09-19T12:00:00.000Z' });
    const baseline = review([old]);
    const fresh = entry('fresh');
    expect(
      weeklySignals([old, fresh], project, baseline, '2026-09-29')
        .filter((s) => s.kind === 'evidence')
        .map((s) => s.recordId),
    ).toEqual(['fresh']);
    expect(
      weeklySignals(
        [old, { ...fresh, evidence: 'Informe' }],
        project,
        baseline,
        '2026-09-29',
      ).filter((s) => s.kind === 'evidence'),
    ).toEqual([]);
    expect(
      weeklySignals(
        [old, { ...fresh, contribution: 'Implementé' }],
        project,
        baseline,
        '2026-09-29',
      ).filter((s) => s.kind === 'evidence'),
    ).toEqual([]);
  });

  it('selecciona una sola aparición por serie, aísla el cuaderno y respeta descartes', () => {
    const first = task('first', {
      recurrence: { seriesId: 'series', occurrenceDate: '2026-09-22', overriddenFields: [] },
    });
    const later = task('later', {
      recurrence: { seriesId: 'series', occurrenceDate: '2026-09-29', overriddenFields: [] },
    });
    const foreign = task('foreign', { project: 'other' });
    const baseline = review([first, later, foreign]);
    const signals = weeklySignals([first, later, foreign], project, baseline, '2026-09-29');
    expect(signals.map((signal) => signal.recordId)).toEqual(['first']);
    baseline.decisions = [{ key: signals[0].key, cause: signals[0].cause, mode: 'dismissed' }];
    expect(visibleWeeklySignals(signals, baseline, '2026-09-29')).toEqual([]);
    expect(
      visibleWeeklySignals([{ ...signals[0], cause: 'changed' }], baseline, '2026-09-29'),
    ).toHaveLength(1);
    expect(
      weeklySignals(
        [{ ...first, recurrence: { ...first.recurrence!, canceledAt: at } }, later],
        project,
        baseline,
        '2026-09-29',
      ).map((s) => s.recordId),
    ).toEqual(['later']);
  });
});
