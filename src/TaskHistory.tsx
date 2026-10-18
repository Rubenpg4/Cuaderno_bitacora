import { useState } from 'react';
import { History as HistoryIcon, RotateCcw } from 'lucide-react';
import type { Check, History, Snapshot, Task } from '../shared/model';
import { api } from './api';
import { Button, Notice } from './ui';

const fields: { key: keyof Task; label: string }[] = [
  { key: 'title', label: 'Título' },
  { key: 'project', label: 'Proyecto' },
  { key: 'phase', label: 'Fase' },
  { key: 'type', label: 'Tipo' },
  { key: 'tags', label: 'Etiquetas' },
  { key: 'priority', label: 'Prioridad' },
  { key: 'state', label: 'Estado' },
  { key: 'due', label: 'Fecha de finalización' },
  { key: 'blocked', label: 'Bloqueo' },
  { key: 'nextStep', label: 'Siguiente paso' },
  { key: 'description', label: 'Descripción' },
  { key: 'solution', label: 'Solución' },
  { key: 'dependencyIds', label: 'Dependencias' },
  { key: 'checks', label: 'Criterios' },
  { key: 'completedAt', label: 'Finalización registrada' },
];

function value(task: Task | null, key: keyof Task, snapshot: Snapshot) {
  if (!task) return '—';
  const raw = task[key];
  if (key === 'project')
    return (
      snapshot.records.find((record) => record.id === raw)?.title ||
      (raw ? String(raw) : 'Trabajo transversal')
    );
  if (key === 'dependencyIds')
    return (
      (raw as string[])
        .map((id) => snapshot.records.find((record) => record.id === id)?.title || id)
        .join(', ') || '—'
    );
  if (key === 'checks')
    return (
      (raw as Check[])
        .map((check) =>
          [
            `${check.title} (v${check.practiceVersion}) · ${check.mandatory ? 'Obligatorio' : 'Recomendación'} · ${check.state}`,
            check.explanation && `Descripción: ${check.explanation}`,
            check.source && `Fuente: ${check.source}`,
            check.note && `Motivo: ${check.note}`,
            check.exceptionReason && `Excepción: ${check.exceptionReason}`,
            check.authorization && `Autorización: ${check.authorization}`,
          ]
            .filter(Boolean)
            .join(' · '),
        )
        .join('\n') || '—'
    );
  if (Array.isArray(raw)) return raw.join(', ') || '—';
  if (key === 'completedAt' && raw) return new Date(String(raw)).toLocaleString('es-ES');
  return raw ? String(raw) : '—';
}

function changes(entry: History, snapshot: Snapshot) {
  const before = entry.before?.kind === 'task' ? entry.before : null;
  const after = entry.after as Task;
  return fields
    .filter(({ key }) =>
      before
        ? JSON.stringify(before[key]) !== JSON.stringify(after[key])
        : Array.isArray(after[key])
          ? after[key].length > 0
          : Boolean(after[key]),
    )
    .map(({ key, label }) => ({
      key,
      label,
      before: value(before, key, snapshot),
      after: value(after, key, snapshot),
      beforeCount: key === 'checks' ? before?.checks.length || 0 : 0,
      afterCount: key === 'checks' ? after.checks.length : 0,
    }));
}

function HistoricalValue({
  label,
  text,
  checkCount,
}: {
  label: string;
  text: string;
  checkCount?: number;
}) {
  return (
    <div className="task-history-value">
      <span>{label}</span>
      {checkCount === undefined ? (
        <p>{text}</p>
      ) : (
        <details>
          <summary>
            {checkCount} {checkCount === 1 ? 'criterio' : 'criterios'} · Ver contenido
          </summary>
          <p>{text}</p>
        </details>
      )}
    </div>
  );
}

export default function TaskHistory({
  task,
  snapshot,
  hasUnsavedChanges,
  onRestored,
}: {
  task: Task;
  snapshot: Snapshot;
  hasUnsavedChanges: boolean;
  onRestored: () => void;
}) {
  const entries = snapshot.history.filter(
    (entry) => entry.recordId === task.id && entry.after.kind === 'task',
  );
  const [visible, setVisible] = useState(10);
  const [selectedId, setSelectedId] = useState(entries[0]?.id || '');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = entries.find((entry) => entry.id === selectedId);
  const selectedChanges = selected ? changes(selected, snapshot) : [];

  async function restore() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await api('restore-task-version', {
        historyId: selected.id,
        taskId: task.id,
        expectedVersion: task.version,
      });
      onRestored();
    } catch (cause) {
      setError((cause as Error).message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="history task-history">
      <summary>
        <HistoryIcon size={15} /> Historial de versiones ({entries.length})
      </summary>
      <p className="muted">Consulta cada cambio y recupera una versión anterior de esta tarea.</p>
      <ol className="task-history-list">
        {entries.slice(0, visible).map((entry) => {
          const changed = changes(entry, snapshot);
          return (
            <li key={entry.id}>
              <button
                type="button"
                className="task-history-version"
                aria-pressed={selectedId === entry.id}
                onClick={() => {
                  setSelectedId(entry.id);
                  setConfirming(false);
                  setError('');
                }}
              >
                <span>
                  <strong>v{entry.after.version}</strong> · {entry.actor}
                  <small>{new Date(entry.at).toLocaleString('es-ES')}</small>
                </span>
                <small>
                  {changed.map((change) => change.label).join(', ') || 'Sin cambios visibles'}
                </small>
              </button>
            </li>
          );
        })}
      </ol>
      {visible < entries.length && (
        <Button variant="secondary" onClick={() => setVisible((count) => count + 10)}>
          Mostrar versiones anteriores
        </Button>
      )}
      {selected && (
        <section
          className="task-history-detail"
          aria-label={`Cambios de la versión ${selected.after.version}`}
        >
          <h4>Versión {selected.after.version}</h4>
          <p className="muted">
            {selected.before
              ? `Cambios respecto a v${selected.before.version}`
              : 'Creación de la tarea'}
          </p>
          {selectedChanges.length ? (
            <dl className="task-history-diff">
              {selectedChanges.map((change) => (
                <div key={change.label}>
                  <dt>{change.label}</dt>
                  <dd className={`task-history-values ${selected.before ? '' : 'single'}`}>
                    {selected.before && (
                      <HistoricalValue
                        label="Antes"
                        text={change.before}
                        checkCount={change.key === 'checks' ? change.beforeCount : undefined}
                      />
                    )}
                    <HistoricalValue
                      label={selected.before ? 'Después' : 'Valor inicial'}
                      text={change.after}
                      checkCount={change.key === 'checks' ? change.afterCount : undefined}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted">Esta versión no modificó campos visibles de la tarea.</p>
          )}
          {selected.after.version !== task.version && (
            <div className="task-history-restore">
              {!confirming ? (
                <Button variant="secondary" onClick={() => setConfirming(true)}>
                  <RotateCcw size={15} /> Restaurar v{selected.after.version}
                </Button>
              ) : (
                <>
                  <p>
                    Se creará una nueva versión a partir de v{selected.after.version}. El historial
                    seguirá disponible. Se aplicarán las reglas actuales de tareas y criterios.
                    {hasUnsavedChanges && ' Los cambios sin guardar del editor se perderán.'}
                  </p>
                  <div className="row">
                    <Button onClick={() => void restore()} disabled={busy}>
                      {busy ? 'Restaurando…' : 'Confirmar restauración'}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                      Cancelar
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}
      {error && <Notice error>{error}</Notice>}
    </details>
  );
}
