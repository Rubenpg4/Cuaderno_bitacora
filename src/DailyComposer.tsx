import { useState, useEffect, useRef } from 'react';
import { Feather, Check, Save, Link2, CheckCircle2, CheckSquare2 } from 'lucide-react';
import {
  isTaskCompletedOnDay,
  type Entry,
  type RecordItem,
  type Snapshot,
  type Task,
} from '../shared/model';
import { blank } from './defaults';
import { saveRecord } from './api';
import { Button, Field, Notice } from './ui';
import { MentionEditor } from './EntryMentions';
import { entryMentionFields, linksFromEntryText } from './entryLinks';
import { useDraft } from './useDraft';
export default function DailyComposer({
  day,
  project,
  snapshot,
  refresh,
  registerFlush,
  openRecord,
}: {
  day: string;
  project: string;
  snapshot: Snapshot;
  refresh: () => Promise<void>;
  registerFlush: (fn: () => Promise<void>) => () => void;
  openRecord: (record: RecordItem) => void;
}) {
  const existing = snapshot.records
    .filter(
      (record): record is Entry =>
        record.kind === 'entry' &&
        record.date === day &&
        record.project === project &&
        (record.daily === true ||
          (record.daily === undefined && record.title === `Avances del ${day}`)),
    )
    .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))[0];
  const draftKey = `daily:${day}:${project || 'none'}`;
  const dayCompletedTasks = snapshot.records.filter(
    (record): record is Task =>
      record.kind === 'task' &&
      isTaskCompletedOnDay(record, day) &&
      (!project || record.project === project),
  );
  const {
    data,
    setData,
    flush,
    reset,
    status: draftStatus,
  } = useDraft(
    draftKey,
    existing || { ...blank('entry'), date: day, project },
    snapshot.drafts?.[draftKey],
  );
  const [saved, setSaved] = useState<Entry | undefined>(
    snapshot.drafts?.[draftKey]?.daily === false ? undefined : existing,
  );
  const [status, setStatus] = useState(
    snapshot.drafts?.[draftKey]
      ? 'Borrador recuperado'
      : existing
        ? 'Entrada diaria cargada'
        : 'Tu registro se guarda mientras escribes',
  );
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(!!snapshot.drafts?.[draftKey]);
  const busy = useRef(false);
  const latest = useRef(data);
  latest.current = data;
  const savedRef = useRef<Entry | undefined>(
    snapshot.drafts?.[draftKey]?.daily === false ? undefined : existing,
  );
  const extraEntry = useRef(snapshot.drafts?.[draftKey]?.daily === false);
  const mounted = useRef(true);
  const pending = useRef<Promise<void> | undefined>(undefined);
  const dirtyRef = useRef(!!snapshot.drafts?.[draftKey]);
  useEffect(() => {
    mounted.current = true;
    const unregister = registerFlush(persist);
    return () => {
      mounted.current = false;
      unregister();
    };
  }, [registerFlush]);
  function change(key: string, value: unknown) {
    setData((d) => {
      const updated = { ...d, [key]: value };
      if (entryMentionFields.includes(key as (typeof entryMentionFields)[number])) {
        const textLinks = linksFromEntryText(updated, snapshot.records);
        const autoTaskIds = snapshot.records
          .filter(
            (r): r is Task =>
              r.kind === 'task' &&
              isTaskCompletedOnDay(r, day) &&
              (!project || r.project === project),
          )
          .map((t) => t.id);
        return {
          ...updated,
          ...textLinks,
          taskIds: Array.from(new Set([...autoTaskIds, ...textLinks.taskIds])),
        };
      }
      return updated;
    });
    setDirty(true);
    dirtyRef.current = true;
  }
  const mentionField = (key: string, label: string, rows = 2, placeholder?: string) => (
    <Field label={label}>
      <MentionEditor
        value={data[key] || ''}
        onChange={(value) => change(key, value)}
        records={snapshot.records}
        onOpen={(record) => {
          void (async () => {
            if (dirtyRef.current) await persist();
            openRecord(record);
          })().catch((cause) => setError((cause as Error).message));
        }}
        rows={rows}
        placeholder={placeholder}
        ariaLabel={label}
      />
    </Field>
  );
  async function persist() {
    if (pending.current) await pending.current;
    if (!dirtyRef.current) return;
    await flush();
    if (!latest.current.activity.trim()) {
      if (mounted.current) setStatus('Borrador guardado en tu equipo');
      return;
    }
    const submitted = latest.current;
    if (mounted.current) {
      setStatus('Guardando…');
      setError('');
    }
    pending.current = (async () => {
      try {
        const autoTaskIds = snapshot.records
          .filter(
            (r): r is Task =>
              r.kind === 'task' &&
              isTaskCompletedOnDay(r, day) &&
              (!project || r.project === project),
          )
          .map((t) => t.id);
        const finalTaskIds = Array.from(new Set([...(submitted.taskIds || []), ...autoTaskIds]));
        const r = (await saveRecord(
          'entry',
          {
            ...submitted,
            taskIds: finalTaskIds,
            daily: !extraEntry.current,
            title: submitted.title.trim() || `Avances del ${day}`,
            original: savedRef.current?.original || submitted.activity,
          },
          savedRef.current,
          draftKey,
        )) as Entry;
        savedRef.current = r;
        if (latest.current === submitted) dirtyRef.current = false;
        if (mounted.current) {
          setSaved(r);
          setStatus('Guardado en tu equipo');
          setDirty(dirtyRef.current);
        }
        await refresh();
      } catch (e) {
        if (mounted.current) {
          setError((e as Error).message);
          setStatus('Cambios sin guardar');
        }
        throw e;
      }
    })();
    try {
      await pending.current;
    } finally {
      pending.current = undefined;
    }
  }
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => void persist().catch(() => {}), 900);
    return () => clearTimeout(timer);
  }, [data, dirty]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  return (
    <section className="daily-composer">
      <div className="section-heading">
        <div className="row">
          <Feather size={21} />
          <h2>Deja constancia de tu día</h2>
        </div>
        <span className="save-status" role="status">
          {status === 'Guardado en tu equipo' ? <Check size={13} /> : <Save size={13} />} {status}
          {draftStatus === 'No se pudo guardar el borrador' && ` · ${draftStatus}`}
        </span>
      </div>
      <p className="muted">
        Unos minutos ahora. Escribe @ para enlazar una incidencia, tarea, decisión o idea.
      </p>
      {dayCompletedTasks.length > 0 && (
        <div
          className="daily-completed-tasks"
          role="region"
          aria-label="Tareas completadas del día"
        >
          <div className="daily-tasks-header">
            <CheckCircle2 size={16} />
            <strong>Tareas completadas este día ({dayCompletedTasks.length})</strong>
            <small className="muted">Avances verificados de la jornada</small>
          </div>
          <div className="daily-tasks-chips">
            {dayCompletedTasks.map((task) => (
              <button
                type="button"
                key={task.id}
                className="daily-task-chip"
                onClick={() => openRecord(task)}
                title={`Ver tarea: ${task.title}`}
              >
                <CheckSquare2 size={14} />
                <span>{task.title}</span>
                {task.due !== day && <span className="chip-due-tag">prevista: {task.due}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {mentionField(
        'activity',
        '¿En qué has avanzado?',
        4,
        'Describe tu avance o escribe @ para vincular un registro…',
      )}
      <div className="form-grid">
        {mentionField('result', 'Resultado', 2, 'Qué ha quedado hecho o más claro')}
        {mentionField('learning', 'Aprendizaje', 2, 'Algo que te llevas de hoy')}
        {mentionField('blocker', 'Bloqueo o ayuda que necesitas', 2, 'Qué te impide avanzar')}
        {mentionField('nextStep', 'Siguiente paso', 2, 'Por dónde continuar')}
      </div>
      <details>
        <summary>
          <Link2 size={14} /> Más detalles de la entrada
        </summary>
        <Field label="Título del registro">
          <input value={data.title} onChange={(e) => change('title', e.target.value)} />
        </Field>
        <Field label="Evidencia o referencia">
          <input
            value={data.evidence}
            onChange={(e) => change('evidence', e.target.value)}
            placeholder="Referencia a una revisión, documento o prueba"
          />
        </Field>
        <Field label="Competencia trabajada">
          <input value={data.competency} onChange={(e) => change('competency', e.target.value)} />
        </Field>
      </details>
      {error && (
        <Notice error>
          {error}
          <Button variant="ghost" onClick={() => void persist()}>
            Reintentar
          </Button>
        </Notice>
      )}
      {saved && (
        <div className="composer-footer">
          <span>
            Entrada vinculada al{' '}
            {new Date(day + 'T12:00:00').toLocaleDateString('es-ES', {
              day: 'numeric',
              month: 'long',
            })}
          </span>
          <Button
            variant="ghost"
            disabled={dirty}
            onClick={() => {
              reset({ ...blank('entry'), date: day, project, daily: false });
              savedRef.current = undefined;
              extraEntry.current = true;
              setSaved(undefined);
              setDirty(false);
              setStatus('Tu registro se guarda mientras escribes');
            }}
          >
            Añadir otro avance
          </Button>
        </div>
      )}
    </section>
  );
}
