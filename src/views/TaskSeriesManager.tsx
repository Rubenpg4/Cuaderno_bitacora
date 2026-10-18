import { useState } from 'react';
import { PRIORITIES, type Task, type TaskSeries } from '../../shared/model';
import { type RecurrenceRule } from '../../shared/recurrence';
import { api } from '../api';
import TaskRecurrenceFields from '../TaskRecurrenceFields';
import { Button, Field, Notice } from '../ui';

function SeriesRow({
  series,
  tasks,
  refresh,
}: {
  series: TaskSeries;
  tasks: Task[];
  refresh: () => Promise<void>;
}) {
  const [rule, setRule] = useState<RecurrenceRule | null>(series.rule);
  const [title, setTitle] = useState(series.template.title);
  const [description, setDescription] = useState(series.template.description);
  const [priority, setPriority] = useState(series.template.priority);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canceled = tasks.filter((task) => task.recurrence?.canceledAt).length;

  async function save() {
    if (!rule) return;
    setError('');
    setBusy(true);
    try {
      await api('save-task-series', {
        id: series.id,
        expectedVersion: series.version,
        data: { ...series.template, title, description, priority, project: series.project },
        rule,
      });
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!window.confirm(`¿Detener la serie «${series.title}» y cancelar sus próximas apariciones?`))
      return;
    setError('');
    setBusy(true);
    try {
      await api('stop-task-series', { id: series.id, expectedVersion: series.version });
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="form-section">
      <summary>
        {series.title} · {series.archivedAt ? 'Detenida' : 'Activa'} · {tasks.length - canceled}{' '}
        apariciones ({canceled} canceladas)
      </summary>
      {series.archivedAt ? (
        <p className="muted">
          La serie está detenida. Las apariciones anteriores y su historial se conservan.
        </p>
      ) : (
        <>
          <Field label="Título de la serie">
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Descripción de la serie">
            <textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <Field label="Prioridad de la serie">
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as Task['priority'])}
            >
              {PRIORITIES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
          <TaskRecurrenceFields
            value={rule}
            onChange={setRule}
            defaultStart={series.rule.start}
            allowNone={false}
          />
          <Button variant="secondary" disabled={busy || !rule} onClick={() => void save()}>
            Guardar serie
          </Button>{' '}
          <Button variant="danger" disabled={busy} onClick={() => void stop()}>
            Detener serie
          </Button>
        </>
      )}
      {error && <Notice error>{error}</Notice>}
    </details>
  );
}

export default function TaskSeriesManager({
  series,
  tasks,
  refresh,
}: {
  series: TaskSeries[];
  tasks: Task[];
  refresh: () => Promise<void>;
}) {
  if (!series.length) return null;
  return (
    <section className="form-section" aria-label="Series recurrentes">
      <h2>Series recurrentes</h2>
      {series.map((item) => (
        <SeriesRow
          key={`${item.id}:${item.version}`}
          series={item}
          tasks={tasks.filter((task) => task.recurrence?.seriesId === item.id)}
          refresh={refresh}
        />
      ))}
    </section>
  );
}
