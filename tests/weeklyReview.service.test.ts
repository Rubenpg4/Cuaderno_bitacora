import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../service/server';
import { blank } from '../service/domain';
import { weeklySignals } from '../shared/weeklyReviewSignals';
import { madridDate, type Meeting, type Snapshot, type Task } from '../shared/model';

describe('API de revisión semanal', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof startServer>>;
  let projectId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bitacora-weekly-review-'));
    app = await startServer({ dir });
    const created = await post('create-project', {
      title: 'Cuaderno de prueba',
      password: 'contraseña extensa de prueba',
    });
    projectId = created.body.records.find(
      (record: { kind: string }) => record.kind === 'project',
    ).id;
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function post(action: string, data: unknown = {}) {
    const response = await fetch(`http://127.0.0.1:${app.port}/api/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  }

  it('genera IDs de acuerdos, valida vínculos y guarda el corte con control de versión', async () => {
    const invalid = await post('save', {
      kind: 'meeting',
      data: {
        ...blank('meeting'),
        project: projectId,
        title: 'Reunión',
        agreementItems: [{ id: 'inventado', text: 'Acuerdo', requiresFollowUp: true }],
      },
    });
    expect(invalid.status).toBe(400);

    const saved = await post('save', {
      kind: 'meeting',
      data: {
        ...blank('meeting'),
        project: projectId,
        title: 'Reunión',
        closedAt: new Date().toISOString(),
        agreementItems: [{ text: 'Revisar el informe', requiresFollowUp: true }],
      },
    });
    expect(saved.status).toBe(200);
    const meeting = saved.body as Meeting;
    expect(meeting.agreementItems?.[0].id).toBeTruthy();
    expect(
      (
        await post('save', {
          kind: 'meeting',
          id: meeting.id,
          expectedVersion: meeting.version,
          data: {
            ...meeting,
            agreementItems: [{ ...meeting.agreementItems![0], followUpTaskId: 'foreign' }],
          },
        })
      ).status,
    ).toBe(400);

    const first = await post('finish-weekly-review', { expectedVersion: 0 });
    expect(first.status).toBe(200);
    expect(first.body.baseline.day).toBe(madridDate());
    expect((await post('finish-weekly-review', { expectedVersion: 0 })).status).toBe(400);
    const snapshot = (await post('snapshot')).body as Snapshot;
    const signal = weeklySignals(
      snapshot.records,
      projectId,
      snapshot.weeklyReview,
      madridDate(),
    )[0];
    expect(signal.key).toBe(`agreement:${meeting.id}:${meeting.agreementItems![0].id}`);
    expect(
      (
        await post('decide-weekly-signal', {
          expectedVersion: 1,
          key: 'agreement:forged:forged',
          cause: signal.cause,
          mode: 'dismissed',
        })
      ).status,
    ).toBe(400);
    const decided = await post('decide-weekly-signal', {
      expectedVersion: 1,
      key: signal.key,
      cause: signal.cause,
      mode: 'postponed',
      until: '2999-01-01',
    });
    expect(decided.status).toBe(200);
    expect(decided.body.decisions).toHaveLength(1);
    expect(
      (
        await post('decide-weekly-signal', {
          expectedVersion: 1,
          key: signal.key,
          cause: signal.cause,
          mode: 'dismissed',
        })
      ).status,
    ).toBe(400);

    const backup = await post('backup', { password: 'contraseña extensa de copia' });
    expect(backup.status).toBe(200);
    const restored = await post('restore', {
      data: backup.body.data,
      password: 'contraseña extensa de copia',
      confirm: 'RESTAURAR',
    });
    expect(restored.status).toBe(200);
    expect(restored.body.weeklyReview.decisions).toHaveLength(1);
  });

  it('crea una tarea y vincula el acuerdo en una transacción; el borrado reactiva la señal', async () => {
    const snapshot = (await post('snapshot')).body as Snapshot;
    const meeting = snapshot.records.find((record) => record.kind === 'meeting') as Meeting;
    const agreementId = meeting.agreementItems![0].id;
    const failed = await post('save-follow-up-task', {
      data: { ...blank('task'), title: 'Seguimiento' },
      meetingId: meeting.id,
      agreementId,
      expectedMeetingVersion: meeting.version - 1,
    });
    expect(failed.status).toBe(400);
    const created = await post('save-follow-up-task', {
      data: { ...blank('task'), title: 'Seguimiento' },
      meetingId: meeting.id,
      agreementId,
      expectedMeetingVersion: meeting.version,
    });
    expect(created.status).toBe(200);
    const task = created.body as Task;
    const linked = (await post('snapshot')).body as Snapshot;
    const updatedMeeting = linked.records.find((record) => record.id === meeting.id) as Meeting;
    expect(updatedMeeting.agreementItems?.[0].followUpTaskId).toBe(task.id);
    expect(linked.weeklyReview?.decisions).toEqual([]);
    expect(
      weeklySignals(linked.records, projectId, linked.weeklyReview, madridDate()).filter(
        (signal) => signal.kind === 'agreement',
      ),
    ).toEqual([]);

    expect((await post('delete-task', { id: task.id, expectedVersion: task.version })).status).toBe(
      200,
    );
    const deleted = (await post('snapshot')).body as Snapshot;
    expect(
      (deleted.records.find((record) => record.id === meeting.id) as Meeting).agreementItems?.[0]
        .followUpTaskId,
    ).toBeUndefined();
    expect(
      weeklySignals(deleted.records, projectId, deleted.weeklyReview, madridDate()).filter(
        (signal) => signal.kind === 'agreement',
      ),
    ).toHaveLength(1);
  });

  it('vuelve a señalar un acuerdo si se cancela su aparición vinculada', async () => {
    const today = madridDate();
    const series = app.domain.saveTaskSeries(
      { ...blank('task'), project: projectId, title: 'Seguimiento recurrente' },
      { frequency: 'monthly', start: today, monthDay: Number(today.slice(8)) },
    );
    app.domain.reconcileTaskSeries();
    const occurrence = app.domain
      .require()
      .records.find(
        (record): record is Task =>
          record.kind === 'task' && record.recurrence?.seriesId === series.id,
      )!;
    const before = (await post('snapshot')).body as Snapshot;
    const meeting = before.records.find((record) => record.kind === 'meeting') as Meeting;
    const linked = await post('save', {
      kind: 'meeting',
      id: meeting.id,
      expectedVersion: meeting.version,
      data: {
        ...meeting,
        agreementItems: meeting.agreementItems?.map((item) => ({
          ...item,
          followUpTaskId: occurrence.id,
        })),
      },
    });
    expect(linked.status).toBe(200);
    expect(
      (await post('delete-task', { id: occurrence.id, expectedVersion: occurrence.version }))
        .status,
    ).toBe(200);
    const canceled = (await post('snapshot')).body as Snapshot;
    expect(
      (canceled.records.find((record) => record.id === occurrence.id) as Task).recurrence
        ?.canceledAt,
    ).toBeTruthy();
    expect(
      (canceled.records.find((record) => record.id === meeting.id) as Meeting).agreementItems?.[0]
        .followUpTaskId,
    ).toBe(occurrence.id);
    expect(
      weeklySignals(canceled.records, projectId, canceled.weeklyReview, today).filter(
        (signal) => signal.kind === 'agreement',
      ),
    ).toHaveLength(1);
    const replacement = await post('save-follow-up-task', {
      data: { ...blank('task'), title: 'Seguimiento de reemplazo' },
      meetingId: meeting.id,
      agreementId: meeting.agreementItems![0].id,
      expectedMeetingVersion: linked.body.version,
    });
    expect(replacement.status).toBe(200);
    const resolved = (await post('snapshot')).body as Snapshot;
    expect(
      weeklySignals(resolved.records, projectId, resolved.weeklyReview, today).filter(
        (signal) => signal.kind === 'agreement',
      ),
    ).toEqual([]);
  });
});
